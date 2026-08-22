"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ padding: 40 }}><h1>Manager could not load</h1><p>No exchange action was taken. Retry the local interface.</p><button onClick={reset}>Try again</button></main>;
}
