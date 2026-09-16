CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('full', 'student_only')),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_email_shaped" CHECK ("users"."email" like '%_@_%._%')
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial" text NOT NULL,
	"label" text,
	"location" text,
	"direction" text DEFAULT 'both' NOT NULL,
	"trust_checking_status" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "devices_serial_unique" UNIQUE("serial"),
	CONSTRAINT "devices_direction_valid" CHECK ("devices"."direction" in ('entry', 'exit', 'both'))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"display_order" integer NOT NULL,
	"late_threshold" time,
	"expects_attendance" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name"),
	CONSTRAINT "groups_branch_valid" CHECK ("groups"."branch" in ('student', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enroll_no" text NOT NULL,
	"full_name" text NOT NULL,
	"group_id" integer,
	"tutor_id" integer,
	"admission_no" text,
	"photo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_enroll_no_unique" UNIQUE("enroll_no")
);
--> statement-breakpoint
CREATE TABLE "tutors" (
	"id" serial PRIMARY KEY NOT NULL,
	"initials" text NOT NULL,
	"full_name" text,
	CONSTRAINT "tutors_initials_unique" UNIQUE("initials")
);
--> statement-breakpoint
CREATE TABLE "unknown_enrollments" (
	"enroll_no" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"scan_count" integer DEFAULT 1 NOT NULL,
	"resolved_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "day_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"status" text NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"has_manual_edit" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone,
	CONSTRAINT "day_records_person_date_key" UNIQUE("person_id","date"),
	CONSTRAINT "day_records_status_valid" CHECK ("day_records"."status" in ('on_site', 'departed', 'late', 'absent', 'not_expected'))
);
--> statement-breakpoint
CREATE TABLE "manual_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_record_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"enroll_no" text NOT NULL,
	"person_id" uuid,
	"att_time" timestamp with time zone NOT NULL,
	"att_time_local" timestamp NOT NULL,
	"checking_status" text,
	"verify_type" text,
	"device_serial" text NOT NULL,
	"direction" text NOT NULL,
	"direction_source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"raw_event_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "scans_direction_valid" CHECK ("scans"."direction" in ('in', 'out', 'unknown')),
	CONSTRAINT "scans_direction_source_valid" CHECK ("scans"."direction_source" in ('device', 'status', 'sequence', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"date" date PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"label" text,
	CONSTRAINT "calendar_days_type_valid" CHECK ("calendar_days"."type" in ('school_day', 'weekend', 'holiday', 'exception'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tutor_id_tutors_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unknown_enrollments" ADD CONSTRAINT "unknown_enrollments_resolved_person_id_people_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_records" ADD CONSTRAINT "day_records_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_day_record_id_day_records_id_fk" FOREIGN KEY ("day_record_id") REFERENCES "public"."day_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "groups_branch_order_idx" ON "groups" USING btree ("branch","display_order");--> statement-breakpoint
CREATE INDEX "people_group_active_idx" ON "people" USING btree ("group_id") WHERE "people"."is_active";--> statement-breakpoint
CREATE INDEX "day_records_date_status_idx" ON "day_records" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "scans_att_time_idx" ON "scans" USING btree ("att_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scans_person_time_idx" ON "scans" USING btree ("person_id","att_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scans_enroll_time_idx" ON "scans" USING btree ("enroll_no","att_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
-- ── The audit log is append-only ──────────────────────────────────────────
-- The specification says no update or delete path exists in the application
-- for any role. Application discipline is not a control on its own: a future
-- handler, a migration, or someone at a psql prompt could still rewrite
-- history. This trigger makes the guarantee the database's.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
