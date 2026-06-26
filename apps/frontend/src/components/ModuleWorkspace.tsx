import React from "react";
import { useStore } from "../store/useStore";
import Module1LoginPanel from "./Module1LoginPanel";
import Module2LoginPanel from "./Module2LoginPanel";
import { Module1 } from "./Module1";
import { Module2 } from "./Module2";

export function ModuleWorkspace({ moduleId }: { moduleId: "module1" | "module2" }) {
  const module1Token = useStore((s) => s.module1Token);
  const module2Token = useStore((s) => s.module2Token);

  if (moduleId === "module1") {
    if (!module1Token) return <Module1LoginPanel />;
    return <Module1 />;
  }

  if (moduleId === "module2") {
    if (!module2Token) return <Module2LoginPanel />;
    return <Module2 />;
  }

  return null;
}

export default ModuleWorkspace;
