import { redirect } from "next/navigation";

/** Stable owner-facing registration link; never hosts a second auth implementation. */
export default function AccountPage() {
  redirect("/copy-center?view=settings&auth=signup");
}
