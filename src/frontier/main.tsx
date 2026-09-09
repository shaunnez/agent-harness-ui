import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { FrontierApp } from "./app/FrontierApp";
import "./ui/frontier.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <FrontierApp />
    </React.StrictMode>,
  );
