CREATE TABLE `saved_scenarios` (
  `identity` text NOT NULL,
  `id` text NOT NULL,
  `name` text NOT NULL,
  `season` integer NOT NULL,
  `week` integer,
  `description` text NOT NULL DEFAULT '',
  `payload` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`identity`, `id`)
);
--> statement-breakpoint
CREATE INDEX `saved_scenarios_identity_updated_idx` ON `saved_scenarios` (`identity`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
  `identity` text PRIMARY KEY NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `alert_events` (
  `identity` text NOT NULL,
  `id` text NOT NULL,
  `type` text NOT NULL,
  `severity` text NOT NULL DEFAULT 'info',
  `team` text,
  `title` text NOT NULL,
  `message` text NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_at` text,
  PRIMARY KEY (`identity`, `id`)
);
--> statement-breakpoint
CREATE INDEX `alert_events_identity_created_idx` ON `alert_events` (`identity`, `created_at`);
--> statement-breakpoint
CREATE INDEX `alert_events_identity_ack_idx` ON `alert_events` (`identity`, `acknowledged_at`);
