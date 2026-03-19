"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "./UserContextProvider";
import { LoadingScreen } from "./components/LoadingScreen";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useUser();

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        router.replace("/login");
      } else {
        router.replace("/workspace");
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return <LoadingScreen />;
}
