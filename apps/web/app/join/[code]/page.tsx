import { redirect } from "next/navigation";

/** Shareable invite links (/join/K7Q2XM) open the join page with the code filled in. */
export default async function JoinCode({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
  redirect(`/join?code=${encodeURIComponent(code)}`);
}
