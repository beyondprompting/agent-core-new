import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import { resolveInternalUserInCORNow } from "../convex/data/internalUserAdminActions";

const profile = { id: 42, first_name: "María José", last_name: "Prueba", email: "maria@example.com" };
const other = { ...profile, id: 17, email: "otra@example.com" };
const duplicate = { ...profile, id: 43, email: "MARIA@example.com" };

test("Validar en COR links only an unambiguous email and reports lookup failures", async (t) => {
  for (const key of ["COR_API_KEY", "COR_CLIENT_SECRET"]) {
    const previous = process.env[key];
    process.env[key] = "test";
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const cases = [
    { name: "name search succeeds", byName: [profile] },
    { name: "other Maria returned by name", byName: [other], list: { data: [other, profile] } },
    { name: "empty name results", byName: [], list: [profile] },
    { name: "no matching email", byName: [], list: [other], error: /ninguna cuenta/ },
    { name: "duplicate in list", byName: [other], list: [profile, duplicate], error: /más de una cuenta/ },
    { name: "duplicate in name search", byName: [profile, duplicate], error: /más de una cuenta/ },
    { name: "list unavailable", byName: [], status: 503, list: [], error: /HTTP 503/ },
    { name: "incomplete list", byName: [], list: { data: [profile], total: 2 }, error: /incompleto/ },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const paths: string[] = [];
      const writes: any[] = [];
      t.mock.method(globalThis, "fetch", async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/v1/oauth/token") return Response.json({ access_token: "test" });
        paths.push(url.pathname + url.search);
        if (url.pathname === "/v1/users/search-by-name/Maria") return Response.json(scenario.byName);
        return Response.json(scenario.list, { status: scenario.status ?? 200 });
      });
      const ctx = {
        auth: { getUserIdentity: async () => ({ subject: "admin|session" }) },
        runQuery: async (ref: any) => {
          switch (getFunctionName(ref)) {
            case "data/userAccess:hasPlatformAdminAccess": return true;
            case "data/approvedExternalUsers:getApprovedExternalUserByUserId": return null;
            case "data/corUsers:getUserBasicInfo": return { name: "Maria Jose Prueba", email: " Maria@EXAMPLE.COM " };
            default: throw new Error("Unexpected query");
          }
        },
        runMutation: async (ref: any, args: any) => {
          assert.equal(getFunctionName(ref), "data/corUsers:upsertCorUser");
          writes.push(args);
        },
      };
      const result = await (resolveInternalUserInCORNow as any)._handler(ctx, { targetUserId: "internal" });
      const expectedPaths = ["/v1/users/search-by-name/Maria"];
      if (scenario.list !== undefined) expectedPaths.push("/v1/users?page=false");
      assert.deepEqual(paths, expectedPaths);
      if (scenario.error) {
        assert.equal(result.ok, false);
        assert.match(result.error, scenario.error);
        assert.deepEqual(writes, []);
      } else {
        assert.equal(result.ok, true);
        assert.deepEqual(writes.map(w => [w.userId, w.corUserId, w.corEmail]), [["internal", profile.id, profile.email]]);
      }
    });
  }
});
