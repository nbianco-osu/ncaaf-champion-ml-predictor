CREATE TABLE `watchlists` (
  `identity` text PRIMARY KEY NOT NULL,
  `payload` text NOT NULL DEFAULT '[]',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
