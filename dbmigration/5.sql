ALTER TABLE user_users_data ADD SYSTEM VERSIONING;
/*
Keep an eye on the following bug: https://jira.mariadb.org/browse/MDEV-19191 (Partitioning in child tables with foreign keys)
When that bug is fixed we should be able to break out the historic data into it's own partition. That should speed up regular reads.
*/