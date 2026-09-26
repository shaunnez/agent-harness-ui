import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { ResearchConsoleApp } from "./ResearchConsoleApp";
import "../ui/frontier.css";
import "./console.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <ResearchConsoleApp />
    </React.StrictMode>,
  );
