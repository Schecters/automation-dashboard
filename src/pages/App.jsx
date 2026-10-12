import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Home from "./pages/Home";

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login isDarkMode={isDarkMode} />} />
        <Route path="/home" element={<Home isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}