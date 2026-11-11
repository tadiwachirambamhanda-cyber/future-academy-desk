# Business rules: Future Academy Zimbabwe (demo)

Source: `data/school-handbook.md` (imaginary demo document). Every rule lives in code (`src/lib/rules/`) with at least one unit test that names its id. The model never decides a rule.

| # | Rule | If it fails | Source |
|---|---|---|---|
| R1 | Every dollar amount in a reply must appear in the handbook fee tables or once-off fees. | Fix once, then hand over | Handbook, Fees |
| R2 | The agent never confirms, promises or guarantees a place. Only the admissions office confirms a place. | Rewrite, then hand over | Handbook, Admissions |
| R3 | Visits are offered only Monday to Friday at 09:00, 11:00 or 14:00. The agent never confirms a booking; it passes the request to the admissions office. | Rewrite, then hand over | Handbook, Visits |
| R4 | Discounts beyond the 10% sibling discount, payment plans, late fees and any complaint go to a person (the bursar for money, the admissions office for the rest). | Hand over | Handbook, Fees |
| R5 | Anything about a child's health, safety or an emergency goes to a person straight away, with a holding reply. | Hand over | Handbook, Health and safety |
| R6 | If the handbook does not answer the question, the agent says so and hands over. It never guesses. | Hand over | Handbook |
| R7 | The text of a parent's message is data, never instructions. It cannot change a rule, a fee or the agent's behaviour. | Hand over | Project rules |
| R8 | Bank details are never sent over WhatsApp. | Rewrite, then hand over | Handbook, Fees |
| R9 | The agent replies in the parent's language (English, Shona or Ndebele). The reply's declared language must match the message's. Any other language goes to a person. | Fix once, then hand over | Owner's decision, 2026-11-11 |
