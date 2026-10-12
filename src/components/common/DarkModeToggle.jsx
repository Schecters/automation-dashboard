import React from "react";

export default function DarkModeToggle({ isDarkMode, setIsDarkMode }) {
  return (
    <button
      type="button"
      onClick={() => setIsDarkMode(!isDarkMode)}
      className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-medium ${
        isDarkMode
          ? "bg-[#1E293B] border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700/50"
          : "bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-100 shadow-sm"
      }`}
      title="Toggle Dark / Light Mode"
    >
      {isDarkMode ? (
        <>
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span className="hidden sm:inline">Light</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          <span className="hidden sm:inline">Dark</span>
        </>
      )}
    </button>
  );
}