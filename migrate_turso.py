import sqlite3
import asyncio
import libsql_client

DB_PATH = "player_database.db"
TURSO_URL = "https://playerdatabase-skulls.aws-eu-west-1.turso.io"
TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODI5MzA2NTUsImlkIjoiMDE5ZjFlZjItMTYwMS03MmZjLWEyNTQtMzYwZjUyYzNjYzdmIiwia2lkIjoiOFhQQ2tiR0YtVGgtOHd1WXlUbVl5RUxEcmFGUG1rSWxBZlhiYU11WUV6cyIsInJpZCI6Ijc0NTEzNWZmLTQ2MDAtNDMyYy04ZGMxLWIwOWMyOTQyOTg3NyJ9.vASokhCcOkx-6LfCYHEleOytcpbSw7t09_HUM5an4vDUhEL8r6UB5UQOiywgbazH9dqHACdh57CFLjFZIBi0Bw"

async def migrate():
    print("Dumping local SQLite database...")
    local_conn = sqlite3.connect(DB_PATH)
    dump_lines = list(local_conn.iterdump())
    local_conn.close()

    clean_lines = []
    for line in dump_lines:
        if line.startswith("BEGIN") or line.startswith("COMMIT") or "sqlite_sequence" in line or line.startswith("PRAGMA"):
            continue
        if line.startswith("CREATE TABLE "):
            table_name = line.split(" ")[2].split("(")[0]
            clean_lines.append(f"DROP TABLE IF EXISTS {table_name};")
        clean_lines.append(line)
        
    dump_sql = "\n".join(clean_lines)
    print(f"Generated {len(clean_lines)} SQL statements.")

    print("Connecting to Turso...")
    async with libsql_client.create_client(url=TURSO_URL, auth_token=TURSO_TOKEN) as client:
        print("Executing dump on Turso...")
        # batch takes an iterable of statements
        await client.batch(clean_lines)
        
        # Verify
        rs = await client.execute("SELECT count(*) as c FROM players")
        print(f"Players in Turso: {rs.rows[0][0]}")
        print("Migration complete!")

if __name__ == "__main__":
    asyncio.run(migrate())
