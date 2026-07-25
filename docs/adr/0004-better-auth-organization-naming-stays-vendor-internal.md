# Better Auth's `organization`/`member` naming stays vendor-internal

Adomata's glossary uses Agency/User, not Organization/Member — but Better Auth's `organization` plugin exposes those names throughout its tables, session fields, and client hooks. Rather than forking Better Auth's naming, the vendor names are kept at that boundary; all Adomata-authored code, routes, and UI use Agency/User. This avoids fighting the library on every future upgrade, at the cost of the DB/API surface not matching product language 1:1.
