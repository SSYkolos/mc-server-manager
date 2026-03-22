import React from "react";
import { useSearchParams } from "react-router-dom";
import LiveAdminWindow from "../components/LiveAdminWindow";

export default function LiveAdminPage() {
  const [searchParams] = useSearchParams();

  const serverId = searchParams.get("serverId") || "";
  const accessToken = searchParams.get("accessToken") || "";

  return <LiveAdminWindow serverId={serverId} accessToken={accessToken} />;
}