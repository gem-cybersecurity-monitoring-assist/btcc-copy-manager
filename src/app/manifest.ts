import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BTCC Copy Trading Manager",
    short_name: "Copy Manager",
    description: "Prepare, confirm, and monitor live BTCC futures orders with deterministic controls.",
    start_url: "/",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#07111f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
