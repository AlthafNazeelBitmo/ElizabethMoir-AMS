-- The school's staff list places each member of staff in a category — HOD,
-- Teaching, Extra-Curricular, Admin, Service, Part-Time — alongside their
-- group, and wants it shown wherever they are listed. It is free text, as
-- the school writes it, so a new category is a word in a spreadsheet and
-- not a deploy. Students have none.
ALTER TABLE "people" ADD COLUMN "category" text;
