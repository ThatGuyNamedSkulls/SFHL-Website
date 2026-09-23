// Child-process probe for tests/db-guard.test.ts: just load lib/db.
import("@/lib/db")
  .then(({ client }) => {
    client.close();
    process.exit(0);
  })
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
