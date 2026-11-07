import { redirect } from "next/navigation";
import { getActiveAppSession } from "@/lib/auth/session";
import LogoManager from "./logo-manager";

export const dynamic = "force-dynamic";

export default async function LogoManagerPage() {
  const session = await getActiveAppSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  if (session.role !== "SYSTEM_ADMIN") redirect("/no-access");
  return <LogoManager />;
}
