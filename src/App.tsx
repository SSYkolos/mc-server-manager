import React from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";

import Login from "./Login";
import ServerList from "./components/ServerList";
import ServerDetails from "./components/ServerDetails";
import CreateServerForm from "./components/CreateServerForm";
import Profile from "./components/Profile";
import ServerConsoleWindow from "./components/ServerConsoleWindow";
import ServerMetricsWindow from "./components/ServerMetricsWindow";
import { BackupProvider } from "./backup/BackupContext";
import { GlobalBackupBar } from "./backup/GlobalBackupBar";
import OwnerTab from "./components/OwnerTab";
import LiveAdminPage from "./pages/LiveAdminPage";
import { ServerDataProvider } from "./ServerDataContext";

import {
  Routes,
  Route,
  useNavigate,
  useParams,
  Navigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";

export default function App() {
  console.log("🟢 App render");

  const navigate = useNavigate();
  const location = useLocation();
  const isDetachedWindow =
    location.pathname.startsWith("/console/") ||
    location.pathname === "/metrics" ||
    location.pathname === "/owner" ||
    location.pathname === "/live-admin";
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return <Login />;
  }

  if (isDetachedWindow) {
    return (
      <Routes>
        <Route path="/console/:serverId/:role" element={<ServerConsoleWindow />} />
        <Route path="/metrics" element={<ServerMetricsWindow />} />
        <Route path="/owner" element={<OwnerPage />} />
        <Route path="/live-admin" element={<LiveAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <BackupProvider>
      <ServerDataProvider userUid={user.uid}>
        <div className="min-h-screen m-0 p-0 relative">
          
          {/* USER MENU */}
          <div className="absolute top-2 left-2 z-20 group">
            <div className="relative inline-block pb-2">
              <button className="bg-gray-200 border border-gray-400 px-3 py-1 rounded hover:bg-gray-300">
                {user.displayName || "tester"}
              </button>

              <div className="absolute left-0 top-full w-44 bg-white border border-gray-300 rounded shadow hidden group-hover:block">
                <button
                  className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                  onClick={() => navigate("/")}
                >
                  Server List
                </button>

                <button
                  className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                  onClick={() => navigate("/profile")}
                >
                  Profile
                </button>

                <button
                  className="block w-full text-left px-3 py-2 hover:bg-gray-100"
                  onClick={() => navigate("/create")}
                >
                  Create Server
                </button>

                <div className="h-px bg-gray-200 my-1" />

                <button
                  className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                  onClick={() => auth.signOut()}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>

          {/* HEADER */}
          <header className="h-12 border-b" />

          <GlobalBackupBar />

          {/* MAIN */}
          <main className="p-4">
            <Routes>
              <Route
                path="/"
                element={
                  <ServerList
                    user={user}
                    onSelect={(id) => navigate(`/server/${id}`)}
                  />
                }
              />

              <Route
                path="/server/:serverId"
                element={<ServerDetailsWrapper user={user} />}
              />

              <Route
                path="/console/:serverId/:role"
                element={<ServerConsoleWindow />}
              />
              <Route path="/metrics" element={<ServerMetricsWindow />} />
              <Route
                path="/create"
                element={
                  <CreateServerForm
                    onCreated={() => navigate("/", { replace: true })}
                  />
                }
              />

              <Route
                path="/profile"
                element={<Profile user={user} />}
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </ServerDataProvider>
    </BackupProvider>
  );
}

function ServerDetailsWrapper({ user }: { user: any }) {
  const { serverId } = useParams<{ serverId: string }>();

  if (!serverId) {
    return <Navigate to="/" replace />;
  }

  return <ServerDetails serverId={serverId} user={user} />;
}

function OwnerPage() {
  const [searchParams] = useSearchParams();

  const serverId = searchParams.get("serverId") || "";
  const accessToken = searchParams.get("accessToken") || "";

  return <OwnerTab serverId={serverId} accessToken={accessToken} />;
}