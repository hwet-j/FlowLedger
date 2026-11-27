"""LedgerSql.kt 의 SQL 이 ledger.py(=docs/provider-sql.md)와 공백 차이를 빼고 같은지 확인한다 (Kotlin 을 실행할 수 없어서 하는 안전장치)."""
import os
import re
import unittest

from . import ledger as L

KT = os.path.join(os.path.dirname(__file__), "..", "..", "modules", "assistant-share", "android", "src", "main", "java",
                  "expo", "modules", "assistantshare", "LedgerSql.kt")

MAP = {
    "BALANCES": "SQL_BALANCES", "ACCOUNTS": "SQL_ACCOUNTS", "CATEGORIES": "SQL_CATEGORIES", "BUDGETS": "SQL_BUDGETS",
    "TX_SELECT": "SQL_TX_SELECT", "TX_BY_ID": "SQL_TX_BY_ID", "TX_BY_REF": "SQL_TX_BY_REF", "TX_ROW": "SQL_TX_ROW",
    "INSERT": "SQL_INSERT", "UPDATE": "SQL_UPDATE", "DELETE": "SQL_DELETE", "BALANCE_ONE": "SQL_BALANCE_ONE",
    "RULES": "SQL_RULES", "RULE_INSERT": "SQL_RULE_INSERT", "RULE_UPDATE_ACCOUNT": "SQL_RULE_UPDATE_ACCOUNT",
    "RULE_DELETE": "SQL_RULE_DELETE", "RULE_COUNT": "SQL_RULE_COUNT",
}
DEFAULTS = {"DEFAULT_ACCOUNT": "SELECT id FROM accounts WHERE is_default=1 AND archived=0 ORDER BY sort, created_at LIMIT 1"}


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_consts(src):
    consts = {}
    for m in re.finditer(r'const val (\w+) = (.*?)(?=\n  (?:const val|fun|/\*\*)|\n\})', src, re.S):
        consts[m.group(1)] = m.group(2).strip()
    return consts


def evaluate(expr, consts):
    def lit(tok):
        tok = tok.strip()
        if tok.startswith('"""'):
            return tok[3:-3]
        if tok.startswith('"'):
            return tok[1:-1]
        return evaluate(consts[tok], consts)
    # " + " 로 이어진 조각 (리터럴 안의 +는 SQL 에 없다고 가정)
    parts = re.findall(r'"""(?:.|\n)*?"""|"[^"\n]*"|\w+', expr)
    text = "".join(lit(p) for p in parts)
    return re.sub(r"\$\{?(\w+)\}?", lambda m: evaluate(consts[m.group(1)], consts) if m.group(1) in consts else m.group(0), text)


class Parity(unittest.TestCase):
    def test_sql_matches_python_reference(self):
        src = open(KT, encoding="utf-8").read()
        consts = parse_consts(src)
        for kt, py in MAP.items():
            self.assertIn(kt, consts, kt)
            self.assertEqual(squash(evaluate(consts[kt], consts)), squash(getattr(L, py)), kt)

    def test_range_query(self):
        src = open(KT, encoding="utf-8").read()
        m = re.search(r'fun txRange\(limit: Int\) = (.*?)\n\n', src, re.S)
        text = evaluate(m.group(1), parse_consts(src)).replace("$limit", "?")
        self.assertEqual(squash(text), squash(L.SQL_TX_RANGE))

    def test_default_account_sql(self):
        consts = parse_consts(open(KT, encoding="utf-8").read())
        self.assertEqual(squash(evaluate(consts["DEFAULT_ACCOUNT"], consts)), squash(DEFAULTS["DEFAULT_ACCOUNT"]))


if __name__ == "__main__":
    unittest.main()
