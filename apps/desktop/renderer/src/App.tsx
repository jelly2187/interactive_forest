import { NavLink, Routes, Route } from "react-router-dom";
import Editor from "./pages/Editor";
import Stage from "./pages/Stage";

export default function App() {
  return (
    <div className="app-root">
      <nav className="topbar">
        <NavLink to="/" end className="tab">Editor</NavLink>
        <NavLink to="/stage" className="tab">Stage</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Editor/>}/>
        <Route path="/stage" element={<Stage/>}/>
      </Routes>
    </div>
  );
}
