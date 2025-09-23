import { NavLink, Routes, Route } from "react-router-dom";
import ControlPanel from "./pages/ControlPanel";
import ProjectionScreen from "./pages/ProjectionScreen";

export default function App() {
  return (
    <div className="app-root">
      <Routes>
        <Route path="/" element={<ControlPanel />} />
        <Route path="/projection" element={<ProjectionScreen />} />
      </Routes>
    </div>
  );
}
