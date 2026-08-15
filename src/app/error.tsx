"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    console.error("Image workflow failed:", error);
  }, [error]);

  return (
    <main
      aria-labelledby="error-title"
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        color: "var(--text-primary, #1D1D1F)",
        background: "var(--page-background, #F5F5F7)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(100%, 30rem)",
          padding: "clamp(1.5rem, 5vw, 2.5rem)",
          textAlign: "center",
          border: "1px solid color-mix(in srgb, currentColor 12%, transparent)",
          borderRadius: "1.5rem",
          background: "var(--surface, rgba(255, 255, 255, 0.88))",
          boxShadow: "0 1.25rem 4rem rgba(0, 0, 0, 0.08)",
        }}
      >
        <p
          aria-hidden="true"
          style={{ margin: "0 0 1rem", fontSize: "2rem" }}
        >
          ↻
        </p>
        <h1
          id="error-title"
          style={{
            margin: 0,
            fontSize: "clamp(1.5rem, 5vw, 2rem)",
            lineHeight: 1.15,
            letterSpacing: "-0.025em",
          }}
        >
          処理を続けられませんでした
        </h1>
        <p style={{ margin: "0.75rem 0 1.5rem", lineHeight: 1.7 }}>
          元の画像は変更されていません。メモリ使用量を減らすため、画像数を少なくして再試行してください。
        </p>
        <button
          type="button"
          onClick={retry}
          style={{
            minHeight: "2.75rem",
            padding: "0.7rem 1.25rem",
            border: 0,
            borderRadius: "999px",
            color: "white",
            background: "#007AFF",
            font: "inherit",
            fontWeight: 650,
            cursor: "pointer",
          }}
        >
          もう一度試す
        </button>
      </section>
    </main>
  );
}
