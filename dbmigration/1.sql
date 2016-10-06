CREATE TABLE IF NOT EXISTS `user_data_fields` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `user_roles_rights` (
  `role` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uri` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`role`,`uri`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `user_users` (
  `uuid` binary(16) NOT NULL,
  `username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`uuid`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS `user_users_data` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `userUuid` binary(16) NOT NULL,
  `fieldId` int(11) unsigned NOT NULL,
  `data` text COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `userUuid` (`userUuid`),
  KEY `fieldId` (`fieldId`),
  KEY `userUuid_fieldId` (`userUuid`,`fieldId`),
  CONSTRAINT `user_users_data_ibfk_1` FOREIGN KEY (`userUuid`) REFERENCES `user_users` (`uuid`),
  CONSTRAINT `user_users_data_ibfk_2` FOREIGN KEY (`fieldId`) REFERENCES `user_data_fields` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
