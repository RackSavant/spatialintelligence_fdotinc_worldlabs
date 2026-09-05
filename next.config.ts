import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // postgres.js opens raw TCP sockets; keep it out of the bundler.
  serverExternalPackages: ["postgres"],
};

export default withWorkflow(nextConfig);
