import os
import tempfile
import threading
import unittest

from . import ledger as L
from . import schema


def fresh():
    db = L.connect()
    schema.seed(db)
    return db


def add(db, **kw):
    kw.setdefault("req_id", "r" + str(abs(hash(str(sorted(kw.items()))))))
    kw.setdefault("type", "expense")
    return L.add(db, kw)


def second_account(db, name="국민카드", kind="card", archived=0):
    db.execute("INSERT INTO accounts(id,name,kind,initial_balance,is_default,archived,sort,created_at) VALUES(?,?,?,0,0,?,1,'2026-01-02T00:00:00.000Z')",
               ("acc_" + name, name, kind, archived))


class Defaults(unittest.TestCase):
    def test_default_account_and_category(self):
        db = fresh()
        r = add(db, amount=9000, date="2026-11-27")
        self.assertEqual(r["account"], {"name": "주 통장", "balance_after": 1_000_000 - 9000})
        self.assertEqual(r["account_source"], "default")
        self.assertEqual(r["transaction"]["category"], "기타")
        self.assertEqual(r["transaction"]["source"], "assistant")
        r2 = add(db, type="income", amount=3_000_000, category="급여", date="2026-11-25")
        self.assertEqual(r2["account"]["balance_after"], 1_000_000 - 9000 + 3_000_000)
        self.assertEqual(add(db, type="income", amount=1000)["transaction"]["category"], "기타수입")

    def test_no_default_account(self):
        db = fresh()
        db.execute("UPDATE accounts SET is_default=0")
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000)
        self.assertEqual(c.exception.code, "invalid")
        self.assertEqual(add(db, amount=1000, account="주 통장")["account_source"], "explicit")

    def test_today_when_date_missing(self):
        db = fresh()
        self.assertEqual(add(db, amount=500)["transaction"]["date"], L.today())


class Matching(unittest.TestCase):
    def test_account_exact_partial_ambiguous(self):
        db = fresh()
        second_account(db, "국민카드")
        second_account(db, "국민은행", "bank")
        self.assertEqual(add(db, amount=1000, account="국민카드")["transaction"]["account"], "국민카드")
        self.assertEqual(add(db, amount=1000, account=" 국민 카드 ")["transaction"]["account"], "국민카드")  # 공백 무시
        self.assertEqual(add(db, amount=1000, account="주통장")["transaction"]["account"], "주 통장")
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000, account="국민")
        self.assertEqual(c.exception.code, "ambiguous")
        self.assertIn("국민카드", c.exception.message)
        self.assertIn("국민은행", c.exception.message)
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000, account="신한")
        self.assertEqual(c.exception.code, "not_found")
        self.assertIn("주 통장", c.exception.message)
        self.assertEqual(add(db, amount=1000, account="acc_국민은행")["transaction"]["account"], "국민은행")  # id

    def test_category_forms(self):
        db = fresh()
        self.assertEqual(add(db, amount=1000, category="외식")["transaction"]["category"], "식비>외식")
        self.assertEqual(add(db, amount=1000, category="식비>배달")["transaction"]["category"], "식비>배달")
        self.assertEqual(add(db, amount=1000, category="식비")["transaction"]["category"], "식비")  # 대분류 직접
        self.assertEqual(add(db, amount=1000, category="카페")["transaction"]["category"], "식비>카페/간식")  # 부분일치
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000, category="운동")  # 취미/여가>운동, 건강>운동
        self.assertEqual(c.exception.code, "ambiguous")
        self.assertIn("취미/여가>운동", c.exception.message)
        self.assertEqual(add(db, amount=1000, category="건강>운동")["transaction"]["category"], "건강>운동")
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000, category="우주여행")
        self.assertEqual(c.exception.code, "not_found")

    def test_category_type_mismatch_is_not_found(self):
        db = fresh()
        with self.assertRaises(L.LedgerError) as c:
            add(db, type="income", amount=1000, category="외식")
        self.assertEqual(c.exception.code, "not_found")
        with self.assertRaises(L.LedgerError):
            add(db, type="expense", amount=1000, category="급여")

    def test_archived_account_rejected_for_write(self):
        db = fresh()
        second_account(db, "예전통장", archived=1)
        with self.assertRaises(L.LedgerError) as c:
            add(db, amount=1000, account="예전통장")
        self.assertEqual(c.exception.code, "invalid")
        # 읽기(query)에는 보관 통장도 나온다
        names = [a["name"] for a in L.query(db)["accounts"]]
        self.assertIn("예전통장", names)


class Rules(unittest.TestCase):
    def test_priority_explicit_rule_default(self):
        db = fresh()
        second_account(db, "국민카드")
        second_account(db, "현금", "cash")
        L.add_rule(db, {"keyword": "넷플릭스", "account": "국민카드", "match": "merchant"})
        r = add(db, amount=17000, merchant="Netflix 넷플릭스", category="구독")
        self.assertEqual((r["transaction"]["account"], r["account_source"]), ("국민카드", "rule"))
        r = add(db, amount=17000, merchant="넷플릭스", account="현금")  # 명시 > 규칙
        self.assertEqual((r["transaction"]["account"], r["account_source"]), ("현금", "explicit"))
        r = add(db, amount=17000, merchant="왓챠")
        self.assertEqual((r["transaction"]["account"], r["account_source"]), ("주 통장", "default"))

    def test_longer_keyword_wins_then_older(self):
        db = fresh()
        second_account(db, "국민카드")
        second_account(db, "현금", "cash")
        L.add_rule(db, {"keyword": "커피", "account": "국민카드"}, now="2026-01-01T00:00:00.000Z")
        L.add_rule(db, {"keyword": "스타벅스커피", "account": "현금"}, now="2026-01-02T00:00:00.000Z")
        self.assertEqual(add(db, amount=5000, merchant="스타벅스 커피")["transaction"]["account"], "현금")
        self.assertEqual(add(db, amount=5000, merchant="이디야 커피")["transaction"]["account"], "국민카드")
        L.add_rule(db, {"keyword": "식당", "account": "국민카드"}, now="2026-01-03T00:00:00.000Z")
        L.add_rule(db, {"keyword": "고기", "account": "현금"}, now="2026-01-01T00:00:00.000Z")
        # 길이 동률(2) → 먼저 만든 규칙(고기)
        self.assertEqual(add(db, amount=5000, merchant="고기 식당")["transaction"]["account"], "현금")

    def test_match_field_and_category_text(self):
        db = fresh()
        second_account(db, "국민카드")
        L.add_rule(db, {"keyword": "구독", "account": "국민카드", "match": "category"})
        L.add_rule(db, {"keyword": "회식", "account": "국민카드", "match": "memo"})
        self.assertEqual(add(db, amount=1, category="취미/여가>구독")["transaction"]["account"], "국민카드")
        self.assertEqual(add(db, amount=1, merchant="구독 서비스")["transaction"]["account"], "주 통장")  # category 규칙은 가맹점에 안 맞음
        self.assertEqual(add(db, amount=1, memo="팀 회식")["transaction"]["account"], "국민카드")
        L.add_rule(db, {"keyword": "취미", "account": "국민카드", "match": "category"})  # 대분류 이름으로도 맞음
        self.assertEqual(add(db, amount=1, category="취미/여가>운동")["transaction"]["account"], "국민카드")
        self.assertEqual(add(db, amount=1, category="건강>운동")["transaction"]["account"], "주 통장")

    def test_archived_rule_account_skipped_and_transfer_ignores_rules(self):
        db = fresh()
        second_account(db, "국민카드")
        L.add_rule(db, {"keyword": "넷플릭스", "account": "국민카드"})
        db.execute("UPDATE accounts SET archived=1 WHERE id='acc_국민카드'")
        self.assertEqual(add(db, amount=1, merchant="넷플릭스")["account_source"], "default")
        db.execute("UPDATE accounts SET archived=0 WHERE id='acc_국민카드'")
        t = add(db, type="transfer", amount=1000, to_account="국민카드", memo="넷플릭스")
        self.assertEqual(t["transaction"]["account"], "주 통장")

    def test_add_rule_update_and_delete(self):
        db = fresh()
        second_account(db, "국민카드")
        second_account(db, "현금", "cash")
        r1 = L.add_rule(db, {"keyword": " 넷플릭스 ", "account": "국민카드"})
        r2 = L.add_rule(db, {"keyword": "넷 플릭스", "account": "현금"})  # 같은 keyword(공백 무시)+match → 통장만 갱신
        self.assertEqual((r1["id"], r2["id"], r2["updated"]), (r1["id"], r1["id"], True))
        q = L.query(db)
        self.assertEqual(q["rules"], [{"id": r1["id"], "keyword": "넷플릭스", "match": "any", "account": "현금"}])
        self.assertEqual(L.delete_rule(db, {"id": r1["id"]}), {"ok": True})
        with self.assertRaises(L.LedgerError) as c:
            L.delete_rule(db, {"id": r1["id"]})
        self.assertEqual(c.exception.code, "not_found")
        for bad in ({"keyword": "", "account": "현금"}, {"keyword": "x", "account": ""}, {"keyword": "x", "account": "현금", "match": "zzz"}, {"keyword": "x" * 41, "account": "현금"}):
            with self.assertRaises(L.LedgerError):
                L.add_rule(db, bad)
        with self.assertRaises(L.LedgerError) as c:
            L.add_rule(db, {"keyword": "x", "account": "없는통장"})
        self.assertEqual(c.exception.code, "not_found")


class Transfers(unittest.TestCase):
    def test_transfer_balances(self):
        db = fresh()
        second_account(db, "적금", "savings")
        t = add(db, type="transfer", amount=200_000, to_account="적금", date="2026-11-27")
        self.assertEqual(t["account"]["balance_after"], 800_000)
        bal = {a["name"]: a["balance"] for a in L.query(db)["accounts"]}
        self.assertEqual(bal, {"주 통장": 800_000, "적금": 200_000})
        self.assertNotIn("category", t["transaction"])
        self.assertEqual(t["transaction"]["to_account"], "적금")

    def test_transfer_rules_of_use(self):
        db = fresh()
        second_account(db, "적금", "savings")
        for kw in ({"type": "transfer", "amount": 1}, {"type": "transfer", "amount": 1, "to_account": "주 통장"},
                   {"type": "transfer", "amount": 1, "to_account": "적금", "category": "외식"},
                   {"type": "expense", "amount": 1, "to_account": "적금"}):
            with self.assertRaises(L.LedgerError) as c:
                add(db, **kw)
            self.assertEqual(c.exception.code, "invalid", kw)

    def test_loan_account_kind_accepted(self):
        db = fresh()
        second_account(db, "주택대출", "loan")  # kind CHECK 에 'loan' 포함
        add(db, type="transfer", amount=300_000, to_account="주택대출")
        bal = {a["name"]: a["balance"] for a in L.query(db)["accounts"]}
        self.assertEqual(bal["주택대출"], 300_000)
        self.assertEqual([a["kind"] for a in L.query(db)["accounts"] if a["name"] == "주택대출"], ["loan"])

    def test_card_goes_negative(self):
        db = fresh()
        second_account(db, "국민카드")
        add(db, amount=50_000, account="국민카드")
        bal = {a["name"]: a["balance"] for a in L.query(db)["accounts"]}
        self.assertEqual(bal["국민카드"], -50_000)


class Idempotency(unittest.TestCase):
    def test_duplicate_req_id(self):
        db = fresh()
        a = add(db, req_id="same-1", amount=9000)
        b = add(db, req_id="same-1", amount=9999, category="외식")  # 같은 요청 재전송: 새로 만들지 않음, 첫 결과 그대로
        self.assertFalse(a["duplicate"])
        self.assertTrue(b["duplicate"])
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(b["transaction"]["amount"], 9000)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 1)
        self.assertEqual(b["account"]["balance_after"], 991_000)

    def test_concurrent_same_req_id_creates_one(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "t.db")
            db0 = L.connect(path)
            schema.seed(db0)
            db0.execute("PRAGMA journal_mode=WAL")
            db0.close()
            results, errors = [], []

            def worker():
                try:
                    db = L.connect(path)
                    results.append(L.add(db, {"req_id": "race-1", "type": "expense", "amount": 1234, "date": "2026-11-27"}))
                    db.close()
                except Exception as e:  # pragma: no cover
                    errors.append(e)

            ts = [threading.Thread(target=worker) for _ in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertEqual(errors, [])
            self.assertEqual(len({r["id"] for r in results}), 1)
            self.assertEqual(sum(1 for r in results if not r["duplicate"]), 1)
            db = L.connect(path)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 1)


class UpdateDelete(unittest.TestCase):
    def test_update_fields_and_clear(self):
        db = fresh()
        second_account(db, "국민카드")
        r = add(db, amount=9000, category="외식", merchant="김밥천국", memo="점심", tags="점심,#회사", time="12:10", date="2026-11-27")
        self.assertEqual(r["transaction"]["tags"], "점심,회사")
        u = L.update(db, {"id": r["id"], "amount": 12000, "account": "국민카드", "category": "배달", "memo": None, "time": None})
        t = u["transaction"]
        self.assertEqual((t["amount"], t["account"], t["category"]), (12000, "국민카드", "식비>배달"))
        self.assertNotIn("memo", t)
        self.assertNotIn("time", t)
        self.assertEqual(t["merchant"], "김밥천국")
        self.assertEqual(u["account"], {"name": "국민카드", "balance_after": -12000})
        self.assertEqual(L.query(db)["accounts"][0]["balance"], 1_000_000)  # 주 통장에서 빠졌음

    def test_update_rejections(self):
        db = fresh()
        r = add(db, amount=9000)
        for bad in ({"id": r["id"], "type": "income"}, {"id": r["id"], "amount": 0}, {"id": r["id"], "date": "2026-02-30"},
                    {"id": r["id"], "category": "급여"}, {"id": r["id"], "to_account": "주 통장"}):
            with self.assertRaises(L.LedgerError, msg=str(bad)):
                L.update(db, bad)
        with self.assertRaises(L.LedgerError) as c:
            L.update(db, {"id": "nope", "amount": 1})
        self.assertEqual(c.exception.code, "not_found")
        self.assertEqual(db.execute("SELECT amount FROM transactions WHERE id=?", (r["id"],)).fetchone()[0], 9000)  # 롤백

    def test_delete(self):
        db = fresh()
        r = add(db, amount=9000)
        d = L.delete(db, {"id": r["id"]})
        self.assertEqual(d["account"]["balance_after"], 1_000_000)
        with self.assertRaises(L.LedgerError) as c:
            L.delete(db, {"id": r["id"]})
        self.assertEqual(c.exception.code, "not_found")
        self.assertFalse(db.in_transaction)

    def test_delete_then_same_req_id_creates_again(self):
        db = fresh()
        r = add(db, req_id="x1", amount=100)
        L.delete(db, {"id": r["id"]})
        self.assertFalse(add(db, req_id="x1", amount=100)["duplicate"])


class Validation(unittest.TestCase):
    def test_invalid_inputs(self):
        db = fresh()
        base = {"req_id": "v1", "type": "expense", "amount": 1000, "date": "2026-11-27"}
        bad = [
            {"req_id": None}, {"req_id": ""}, {"req_id": "a b"}, {"req_id": "x" * 65}, {"type": "refund"}, {"type": None},
            {"amount": 0}, {"amount": -5}, {"amount": 1.5}, {"amount": "9000"}, {"amount": True}, {"amount": None},
            {"amount": 10_000_000_000}, {"date": "2026-13-01"}, {"date": "1999-12-31"}, {"date": "2101-01-01"}, {"date": "11/27"},
            {"time": "25:00"}, {"time": "9:00"}, {"merchant": "x" * 101}, {"memo": "x" * 501}, {"tags": "x" * 21}, {"tags": ",".join(f"t{i}" for i in range(11))},
            {"tags": 5},
        ]
        for patch in bad:
            with self.assertRaises(L.LedgerError, msg=str(patch)) as c:
                L.add(db, {**base, **patch})
            self.assertIn(c.exception.code, ("invalid",), str(patch))
        with self.assertRaises(L.LedgerError):
            L.add(db, "not a dict")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0], 0)
        self.assertFalse(db.in_transaction)

    def test_valid_edges(self):
        db = fresh()
        self.assertEqual(add(db, amount=9_999_999_999, date="2100-12-31", time="23:59")["transaction"]["amount"], 9_999_999_999)
        self.assertEqual(add(db, amount=1, date="2000-01-01", time="00:00")["transaction"]["date"], "2000-01-01")
        self.assertEqual(add(db, amount=2000.0)["transaction"]["amount"], 2000)  # 정수 값 float 허용
        self.assertEqual(add(db, amount=1, tags="  a, #b ,a ,,")["transaction"]["tags"], "a,b")  # 정리·중복 제거


class Query(unittest.TestCase):
    def test_window_defaults_and_shape(self):
        db = fresh()
        second_account(db, "국민카드")
        add(db, amount=1000, date=L.today(), account="국민카드", category="외식", merchant="김밥")
        add(db, amount=2000, date="2020-01-01")  # 90일 밖
        db.execute("INSERT INTO budgets(id,category_id,amount) VALUES('b1','cat_food',300000)")
        db.execute("INSERT INTO budgets(id,category_id,amount) VALUES('b2',NULL,1000000)")
        q = L.query(db, None, now_ms=123)
        self.assertEqual((q["v"], q["app"], q["ts"]), (1, "flowledger", 123))
        self.assertEqual(len(q["transactions"]), 1)
        self.assertEqual(q["transactions"][0]["category"], "식비>외식")
        self.assertEqual({(b["category"], b["amount"]) for b in q["budgets"]}, {("식비", 300000), (None, 1000000)})
        self.assertFalse(q["truncated"])
        self.assertTrue(any(c == {"id": "cat_food_dining", "name": "외식", "type": "expense", "parent": "식비"} for c in q["categories"]))
        self.assertEqual(q["rules"], [])

    def test_range_order_limit_span(self):
        db = fresh()
        for i in range(5):
            add(db, amount=100 + i, date="2026-11-2%d" % i, time="10:0%d" % i)
        q = L.query(db, {"from": "2026-11-01", "to": "2026-11-30", "limit": 3})
        self.assertEqual([t["amount"] for t in q["transactions"]], [104, 103, 102])
        self.assertTrue(q["truncated"])
        self.assertEqual(L.query(db, {"from": "2026-11-22", "to": "2026-11-23"})["transactions"][0]["date"], "2026-11-23")
        for bad in ({"from": "2026-11-30", "to": "2026-11-01"}, {"from": "2025-01-01", "to": "2026-11-30"}, {"limit": 0}, {"from": "x"}):
            with self.assertRaises(L.LedgerError):
                L.query(db, bad)
        self.assertEqual(L.query(db, {"from": "2026-11-01", "to": "2026-11-30", "limit": 99999})["truncated"], False)  # 상한 3000 으로 보정


if __name__ == "__main__":
    unittest.main()
