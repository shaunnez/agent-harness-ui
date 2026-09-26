import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel/900.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/eb-garamond/400-italic.css";
import { EmpireApp } from "./EmpireApp";
import "./empire.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <EmpireApp />
    </React.StrictMode>,
  );
