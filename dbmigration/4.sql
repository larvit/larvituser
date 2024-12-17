ALTER TABLE user_users ADD IF NOT EXISTS `created` timestamp NOT NULL DEFAULT current_timestamp();
ALTER TABLE user_users ADD IF NOT EXISTS `updated` timestamp NULL DEFAULT NULL;
