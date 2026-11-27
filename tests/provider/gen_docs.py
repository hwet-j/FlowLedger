"""docs/provider-sql.md 의 "## SQL" 절을 ledger.py 상수에서 다시 만든다: python3 -m tests.provider.gen_docs"""
import os
from . import ledger as L

NAMES = ['SQL_BALANCES', 'SQL_ACCOUNTS', 'SQL_CATEGORIES', 'SQL_BUDGETS', 'SQL_TX_SELECT', 'SQL_TX_RANGE', 'SQL_TX_BY_ID', 'SQL_TX_BY_REF', 'SQL_TX_ROW',
         'SQL_INSERT', 'SQL_UPDATE', 'SQL_DELETE', 'SQL_BALANCE_ONE', 'SQL_RULES', 'SQL_RULE_INSERT', 'SQL_RULE_UPDATE_ACCOUNT', 'SQL_RULE_DELETE',
         'SQL_RULE_COUNT', 'SQL_ITEMS_FOR_TX', 'SQL_ITEMS_RANGE', 'SQL_ITEM_INSERT', 'SQL_ITEMS_DELETE', 'SQL_ITEMS_SUM']

path = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "provider-sql.md")
doc = open(path, encoding="utf-8").read()
head = doc[:doc.index("## SQL")]
sql = "\n\n".join(f"-- {n}\n{getattr(L, n).strip()};" for n in NAMES)
open(path, "w", encoding="utf-8").write(head + "## SQL (tests/provider/ledger.py 상수와 동일)\n```sql\n" + sql + "\n```\n")
