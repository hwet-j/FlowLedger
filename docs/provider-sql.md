# FlowLedger 제공자: SQL 과 규칙

`modules/assistant-share` (Kotlin `LedgerApi.kt`, `LedgerSql.kt`)는 **`tests/provider/ledger.py` 의 한 줄씩 포팅**이다.
규칙을 바꿀 때는 ① 이 문서 ② `tests/provider/ledger.py` + 테스트 ③ Kotlin 순서로 고친다.
Kotlin 은 이 환경에서 실행할 수 없어서(Android 에뮬레이터 없음), 동작은 Python 참조 구현의 테스트(`python3 -m unittest tests.provider.test_provider`)로 고정한다.

- authority `com.hwetj.flowledger.assistant`, `ContentResolver.call(Uri("content://com.hwetj.flowledger.assistant"), method, argJson, null)`
- 호출자: `getCallingPackage() == "com.hwetj.assistant"` (null 이면 호출 uid 의 패키지 목록에 포함) 아니면 `forbidden`
- DB: `<filesDir>/SQLite/flowledger.db` (expo-sqlite 와 같은 파일). 없거나 테이블이 없으면 `no_db`
- 응답 Bundle: 성공 `json`+`ts`, 실패 `error`+`message`. 오류 코드: `forbidden no_db unknown_method invalid ambiguous not_found db_error unavailable`
- ContentProvider 본연의 query/insert/update/delete/getType 은 null/0 (다른 경로 없음)

## 메서드
| method | arg(JSON) | 성공 json |
|---|---|---|
| `query` | `{from?, to?, limit?, include_items?}` (기본 최근 90일, 최대 400일, limit 기본 1500 최대 3000) | `{v,app,ts,from,to,accounts[],categories[],budgets[],rules[],transactions[],truncated}` |
| `add` | `{req_id, type, amount?, date?, time?, account?, to_account?, category?, merchant?, memo?, tags?, items?}` (items 가 있으면 amount 생략 가능=품목 합계) | `{ok,id,duplicate,transaction,account:{name,balance_after},account_source}` |
| `update` | `{id, 바꿀 필드만, items?(전체 교체, [] 는 품목 삭제)}` (type 변경 불가, null 로 time/merchant/memo/tags 비우기) | `{ok,transaction,account}` |
| `delete` | `{id}` | `{ok,deleted,account}` |
| `items` | `{from?, to?, text?, merchant?, limit?}` (기본 최근 90일, text=품목명 부분일치(공백·대소문자 무시), limit 기본 200 최대 500) | `{v,ts,from,to,count,truncated,items:[{tx_id,date,merchant?,account,name,qty,unit_price?,amount,category?}]}` (날짜 내림차순) |
| `add_rule` | `{keyword, account, match?}` | `{ok,id,updated}` |
| `delete_rule` | `{id}` | `{ok}` |

## 규칙
- **이름 정규화** `norm(s)` = 모든 공백 제거 + 소문자. 통장/카테고리 매칭은 id 일치 → 정규화 이름 완전일치(1건이면 확정, 2건 이상 `ambiguous`) → 부분일치(1건이면 확정, 2건 이상 `ambiguous`) → `not_found`(후보 나열).
- **통장(쓰기)**: 보관(archived) 통장은 후보에서 빼고, 보관 통장을 가리키면 `invalid`. query 응답에는 보관 통장도 나온다.
- **카테고리**: 거래 type 과 같은 type 만 후보(수입/지출 불일치는 `not_found`). `"대분류>소분류"` 형태 허용. 대분류를 직접 지정해도 된다. 생략하면 지출 `cat_misc`, 수입 `cat_inc_misc`. 이체에는 카테고리 불가.
- **통장 결정 우선순위(add)**: ① 명시 `account` ② 규칙(`account_rules`: merchant/memo/카테고리 표시이름 `"대분류>소분류"` 에 keyword(정규화) 포함. 여러 개면 keyword 가 긴 규칙, 동률이면 created_at 이른 것, 그다음 id. 보관 통장 규칙은 건너뜀. 이체에는 규칙 미적용) ③ `is_default=1` 인 비보관 통장. 없으면 `invalid`. 응답 `account_source` = `explicit|rule|default`.
- **이체**: `to_account` 필수, 출금과 달라야 함, 이체가 아닌데 `to_account` 주면 `invalid`.
- **멱등**: `req_id`(`[A-Za-z0-9_.:-]{1,64}`)를 `source_ref` 에 저장. 같은 `req_id` 는 새로 만들지 않고 처음 결과를 `duplicate:true` 로 돌려줌. `BEGIN IMMEDIATE` + UNIQUE 위반 시 재조회로 동시 요청도 1건만 생성.
- **검증**: amount 정수 1..9_999_999_999, date `YYYY-MM-DD` 실존 날짜 2000-01-01..2100-12-31(생략 시 기기 오늘), time `HH:MM`, merchant ≤100, memo ≤500, tags 쉼표/배열 → 앞 `#` 제거·공백 정리·중복 제거, 항목 ≤20자, 10개까지.
- **영수증 품목(items)**: `[{name(≤80), qty?(0<qty≤1,000,000, 기본 1, 소수 허용), unit_price?(정수≥0), amount(정수, 할인·쿠폰은 음수), category?(이름 매칭 규칙 동일, 거래 type 과 같은 분류만)}]`, 최대 100개, 이체에는 불가. **불변식**: 품목이 있으면 `SUM(amount) == 거래 amount`, 어긋나면 `invalid` "품목 합계 N원 ≠ 총액 M원"(add·update 모두, 롤백). `add` 에서 amount 를 생략하면 합계를 총액으로 쓴다(합계가 1 미만이면 invalid). `update` 는 `items` 를 주면 전체 교체(총액과 맞아야 함), `items:[]` 는 품목 삭제(총액 유지), `amount` 만 바꾸는데 기존 품목 합계와 다르면 `invalid`(items 도 함께 보내게 안내). `delete` 는 `foreign_keys` 에 기대지 않고 품목을 먼저 명시적으로 지운다. 거래 응답은 품목이 있을 때만 `items` 키를 둔다(`query` 는 `include_items:true` 일 때만).
- **잔액** 은 저장하지 않고 `SQL_BALANCES` 로 계산(카드는 음수 가능).
- 쓰기는 모두 `BEGIN IMMEDIATE`(Kotlin `beginTransactionNonExclusive`) 한 트랜잭션. 오류면 롤백.
- 응답의 거래는 id 가 아니라 표시 이름(통장 이름, 카테고리 `"대분류>소분류"`)을 쓰고, 비어 있는 선택 필드는 키를 생략한다.
- 고정거래(`source='recurring'`)를 삭제하면 `source_ref` 가 풀려, 앱이 같은 날짜분을 다시 만들 수 있다(앱 쪽 `last_run` 으로 막을 것).

## SQL (tests/provider/ledger.py 상수와 동일)
```sql
-- SQL_BALANCES
SELECT a.id AS id, a.name AS name, a.kind AS kind, a.is_default AS is_default, a.archived AS archived,
  a.initial_balance
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='income' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='expense' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND account_id=a.id),0)
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND to_account_id=a.id),0) AS balance
FROM accounts a ORDER BY a.sort, a.created_at, a.name;

-- SQL_ACCOUNTS
SELECT id, name, is_default, archived FROM accounts ORDER BY sort, created_at, name;

-- SQL_CATEGORIES
SELECT c.id AS id, c.name AS name, c.type AS type, c.parent_id AS parent_id, p.name AS parent_name, c.archived AS archived
FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.sort, c.name;

-- SQL_BUDGETS
SELECT b.amount AS amount, c.name AS name, p.name AS parent_name
FROM budgets b LEFT JOIN categories c ON c.id = b.category_id LEFT JOIN categories p ON p.id = c.parent_id;

-- SQL_TX_SELECT
SELECT t.id, t.type, t.amount, t.date, t.time, a.name AS account, ta.name AS to_account,
  c.name AS category, p.name AS category_parent, t.merchant, t.memo, t.tags, t.source
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN categories p ON p.id = c.parent_id;

-- SQL_TX_RANGE
SELECT t.id, t.type, t.amount, t.date, t.time, a.name AS account, ta.name AS to_account,
  c.name AS category, p.name AS category_parent, t.merchant, t.memo, t.tags, t.source
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN categories p ON p.id = c.parent_id
WHERE t.date >= ? AND t.date <= ?
ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.created_at DESC LIMIT ?;

-- SQL_TX_BY_ID
SELECT t.id, t.type, t.amount, t.date, t.time, a.name AS account, ta.name AS to_account,
  c.name AS category, p.name AS category_parent, t.merchant, t.memo, t.tags, t.source
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN categories p ON p.id = c.parent_id WHERE t.id = ?;

-- SQL_TX_BY_REF
SELECT id FROM transactions WHERE source_ref = ?;

-- SQL_TX_ROW
SELECT * FROM transactions WHERE id = ?;

-- SQL_INSERT
INSERT INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,'assistant',?,?,?);

-- SQL_UPDATE
UPDATE transactions SET amount=?, date=?, time=?, account_id=?, to_account_id=?, category_id=?, merchant=?, memo=?, tags=?, updated_at=? WHERE id=?;

-- SQL_DELETE
DELETE FROM transactions WHERE id = ?;

-- SQL_BALANCE_ONE
SELECT balance FROM (
SELECT a.id AS id, a.name AS name, a.kind AS kind, a.is_default AS is_default, a.archived AS archived,
  a.initial_balance
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='income' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='expense' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND account_id=a.id),0)
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND to_account_id=a.id),0) AS balance
FROM accounts a ORDER BY a.sort, a.created_at, a.name) WHERE id = ?;

-- SQL_RULES
SELECT r.id AS id, r.keyword AS keyword, r.match AS match, r.account_id AS account_id, a.name AS account, a.archived AS archived, r.created_at AS created_at
FROM account_rules r JOIN accounts a ON a.id = r.account_id ORDER BY r.created_at, r.id;

-- SQL_RULE_INSERT
INSERT INTO account_rules(id,keyword,match,account_id,created_at) VALUES(?,?,?,?,?);

-- SQL_RULE_UPDATE_ACCOUNT
UPDATE account_rules SET account_id=? WHERE id=?;

-- SQL_RULE_DELETE
DELETE FROM account_rules WHERE id=?;

-- SQL_RULE_COUNT
SELECT COUNT(*) FROM account_rules;

-- SQL_ITEMS_FOR_TX
SELECT i.name AS name, i.qty AS qty, i.unit_price AS unit_price, i.amount AS amount, c.name AS category, p.name AS category_parent
FROM transaction_items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN categories p ON p.id = c.parent_id
WHERE i.transaction_id = ? ORDER BY i.sort, i.id;

-- SQL_ITEMS_RANGE
SELECT t.id AS tx_id, t.date AS date, t.merchant AS merchant, a.name AS account,
  i.name AS name, i.qty AS qty, i.unit_price AS unit_price, i.amount AS amount, c.name AS category, p.name AS category_parent
FROM transaction_items i
JOIN transactions t ON t.id = i.transaction_id
JOIN accounts a ON a.id = t.account_id
LEFT JOIN categories c ON c.id = i.category_id
LEFT JOIN categories p ON p.id = c.parent_id
WHERE t.date >= ? AND t.date <= ?
ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.created_at DESC, i.sort, i.id;

-- SQL_ITEM_INSERT
INSERT INTO transaction_items(id,transaction_id,name,qty,unit_price,amount,category_id,sort) VALUES(?,?,?,?,?,?,?,?);

-- SQL_ITEMS_DELETE
DELETE FROM transaction_items WHERE transaction_id = ?;

-- SQL_ITEMS_SUM
SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM transaction_items WHERE transaction_id = ?;
```
