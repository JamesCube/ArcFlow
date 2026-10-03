"""Disposable CI-only RuoYi identities. Never import this fixture in production."""
import os
import bcrypt
import pymysql

USERS = {100: "applicant", 101: "first", 102: "second", 103: "outsider", 104: "nopermission"}


def connection():
    return pymysql.connect(host=os.getenv("MYSQL_HOST", "127.0.0.1"),
                           port=int(os.getenv("MYSQL_PORT", "3306")),
                           user=os.getenv("MYSQL_USER", "root"),
                           password=os.environ["MYSQL_PASSWORD"],
                           database=os.getenv("MYSQL_DATABASE", "ry-vue"),
                           charset="utf8mb4", autocommit=True)


def install(password):
    # Parameters, not interpolated SQL, keep generated values out of query syntax.
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()
    with connection() as db, db.cursor() as cur:
        cur.execute("UPDATE sys_config SET config_value='false' WHERE config_key='sys.account.captchaEnabled'")
        # The database is newly imported for this job. Replace upstream demo passwords too.
        cur.execute("UPDATE sys_user SET password=%s,pwd_update_date=NOW()", (hashed,))
        for uid, name in USERS.items():
            cur.execute("""INSERT INTO sys_user
                (user_id,dept_id,user_name,nick_name,password,status,del_flag,create_by,create_time,pwd_update_date)
                VALUES (%s,103,%s,%s,%s,'0','0','arcflow-ci',NOW(),NOW())""",
                        (uid, "arcflow_" + name, "CI " + name, hashed))
        cur.execute("""INSERT INTO sys_role
            (role_id,role_name,role_key,role_sort,status,del_flag)
            VALUES (21000,'ArcFlow CI participant','arcflow_ci',50,'0','0'),
                   (21001,'ArcFlow CI no permissions','arcflow_ci_none',51,'0','0')""")
        for uid in USERS:
            cur.execute("INSERT INTO sys_user_role(user_id,role_id) VALUES(%s,%s)",
                        (uid, 21001 if uid == 104 else 21000))
        cur.execute("""INSERT INTO sys_role_menu(role_id,menu_id)
            SELECT 21000,menu_id FROM sys_menu
            WHERE menu_id BETWEEN 21000 AND 21005 AND
              (COALESCE(perms,'')='' OR perms IN
               ('arcflow:request:read','arcflow:request:submit','arcflow:request:decide'))""")


def actor_state(uid, *, status="0", deleted="0"):
    assert uid in USERS, "Only disposable test accounts may be modified"
    with connection() as db, db.cursor() as cur:
        cur.execute("UPDATE sys_user SET status=%s,del_flag=%s WHERE user_id=%s", (status, deleted, uid))
