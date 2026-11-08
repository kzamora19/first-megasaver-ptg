"use client";

import { useSearchParams } from "next/navigation";
import AcceptInvitation from "./accept-invitation";

export default function InvitationAcceptPage() {
  const searchParams = useSearchParams();
  return <AcceptInvitation token={searchParams.get("token") ?? ""} />;
}
