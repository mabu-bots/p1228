-- ===== 1. 旧データの移行 =====
-- Rows purchased before fulfillment tracking existed were already fulfilled
-- by the previous purchase flow. Only post-migration purchases may remain pending.
UPDATE user_inventory
   SET role_status='fulfilled'
 WHERE role_status='pending'
   AND role_id=''
   AND purchased_at < (
       SELECT applied_at FROM schema_migrations WHERE version=3
   );
