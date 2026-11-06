-- Monthly budget becomes a running pot (DropCart Budget). Rename keeps values.
ALTER TABLE "User" RENAME COLUMN "monthlyBudget" TO "budget";
