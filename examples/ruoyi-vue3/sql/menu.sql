-- Apply once to a NEW disposable RuoYi database, after upstream ry_20260417.sql.
-- Explicit columns protect against upstream schema order changes. No users/passwords here.
-- IDs 21000-21005 are reserved by this example; collisions intentionally fail.
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time) VALUES
(21000, 'ArcFlow', 0, 20, 'arcflow', NULL, 1, 0, 'M', '0', '0', '', 'tree', 'arcflow-example', NOW()),
(21001, '审批工作台', 21000, 1, 'approval', 'arcflow/approval/index', 1, 0, 'C', '0', '0', 'arcflow:request:read', 'form', 'arcflow-example', NOW()),
(21002, '查看审批', 21001, 1, '', NULL, 1, 0, 'F', '0', '0', 'arcflow:request:read', '#', 'arcflow-example', NOW()),
(21003, '发起审批', 21001, 2, '', NULL, 1, 0, 'F', '0', '0', 'arcflow:request:submit', '#', 'arcflow-example', NOW()),
(21004, '处理审批', 21001, 3, '', NULL, 1, 0, 'F', '0', '0', 'arcflow:request:decide', '#', 'arcflow-example', NOW()),
(21005, '发布流程', 21001, 4, '', NULL, 1, 0, 'F', '0', '0', 'arcflow:process:publish', '#', 'arcflow-example', NOW());
-- Assign these menus to chosen roles through RuoYi's native role management UI.
-- A permission permits an operation; it never bypasses the snapshotted assigned approver.
