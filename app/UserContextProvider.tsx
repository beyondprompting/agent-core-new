"use client";
import React, { createContext, useContext } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

interface User {
  _id: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
}

interface UserContextType {
  user: User | null | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within UserContextProvider");
  }
  return context;
}

export default function UserContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { signOut } = useAuthActions();
  const user = useQuery(api.data.users.viewer);

  const handleSignOut = async () => {
    await signOut();
  };

  const value: UserContextType = {
    user,
    isLoading: user === undefined,
    isAuthenticated: user !== null && user !== undefined,
    signOut: handleSignOut,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
