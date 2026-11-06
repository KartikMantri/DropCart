-- Close Supabase's auto-generated REST/GraphQL API (PostgREST) over our tables.
-- The anon key is public (NEXT_PUBLIC_SUPABASE_ANON_KEY), so with RLS off anyone
-- could read and write every row through https://<project>.supabase.co/rest/v1.
--
-- DropCart never uses that API: all access is server-side Prisma as the table
-- owner (postgres), which RLS does not restrict. RLS on + no policies = the API
-- roles see nothing; the grants are revoked as a second lock.

ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogueCache"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LikedItem"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Watch"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mandate"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceCheck"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Purchase"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
