import { redirect } from "next/navigation";

/** Stable mobile sign-in link to the existing session-backed account form. */
export default function SignInPage() {
  redirect("/copy-center?view=settings&auth=signin");
}
