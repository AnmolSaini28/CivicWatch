import React, {useEffect, useState} from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import {MapContainer, TileLayer, Marker, Popup} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const API = "http://localhost:5000/api";

const USERS_KEY="cw_users", SESSION_KEY="cw_session";
const readUsers=()=>{try{return JSON.parse(localStorage.getItem(USERS_KEY))||[]}catch{return[]}};
async function hash(text){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")}

function App(){
 const [page,setPage]=useState("home"), [issues,setIssues]=useState([]), [dash,setDash]=useState(null);
 const [user,setUser]=useState(()=>{try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch{return null}});
 const [authMsg,setAuthMsg]=useState({type:"",text:""});
 const [trackId,setTrackId]=useState(""), [tracked,setTracked]=useState(null);
 const loadIssues=()=>axios.get(API+"/issues").then(r=>setIssues(r.data)).catch(()=>setIssues([]));
 const loadDash=()=>axios.get(API+"/dashboard").then(r=>setDash(r.data)).catch(()=>setDash(null));
 useEffect(()=>{loadIssues();loadDash()},[]);

 async function track(e){e.preventDefault();try{const r=await axios.get(API+"/issues/track/"+trackId);setTracked(r.data)}catch{setTracked({error:"No issue found with this tracking ID"})}}

 // Frontend-only auth (demo). Replace the localStorage logic below with axios.post(API+"/auth/signup" | "/auth/login") once the backend supports it.
 function go(p){setAuthMsg({type:"",text:""});setPage(p);window.scrollTo(0,0)}
 async function signup(e){
   e.preventDefault(); const f=Object.fromEntries(new FormData(e.target)); const email=f.email.trim().toLowerCase();
   if(f.name.trim().length<2) return setAuthMsg({type:"error",text:"Please enter your full name."});
   if(!f.gender) return setAuthMsg({type:"error",text:"Please select your gender."});
   const mobile=f.mobile.replace(/[\s-]/g,"").replace(/^(\+91|0)/,"");
   if(!/^[6-9]\d{9}$/.test(mobile)) return setAuthMsg({type:"error",text:"Enter a valid 10-digit Indian mobile number."});
   if(f.password.length<8) return setAuthMsg({type:"error",text:"Password must be at least 8 characters."});
   if(f.password!==f.confirm) return setAuthMsg({type:"error",text:"Passwords do not match."});
   const users=readUsers();
   if(users.some(u=>u.email===email)) return setAuthMsg({type:"error",text:"An account with this email already exists. Please log in."});
   if(users.some(u=>u.mobile===mobile)) return setAuthMsg({type:"error",text:"This mobile number is already registered."});
   users.push({name:f.name.trim(),email,gender:f.gender,mobile,password:await hash(f.password)});
   localStorage.setItem(USERS_KEY,JSON.stringify(users));
   const session={name:f.name.trim(),email}; localStorage.setItem(SESSION_KEY,JSON.stringify(session)); setUser(session); go("home");
 }
 async function login(e){
   e.preventDefault(); const f=Object.fromEntries(new FormData(e.target)); const email=f.email.trim().toLowerCase();
   const found=readUsers().find(u=>u.email===email);
   if(!found||found.password!==await hash(f.password)) return setAuthMsg({type:"error",text:"Incorrect email or password."});
   const session={name:found.name,email}; localStorage.setItem(SESSION_KEY,JSON.stringify(session)); setUser(session); go("home");
 }
 function logout(){localStorage.removeItem(SESSION_KEY);setUser(null);go("home")}

 const Nav=()=> <nav><div className="brand">🇮🇳 CivicWatch</div><div className="links">{["home","map","dashboard","track"].map(x=><button key={x} onClick={()=>go(x)} className={page===x?"active":""}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div><div className="auth">{user?<><span className="hello">Hi, {user.name.split(" ")[0]}</span><button onClick={logout}>Logout</button></>:<><button onClick={()=>go("login")} className={page==="login"?"active":""}>Login</button><button className="primary" onClick={()=>go("signup")}>Sign up</button></>}</div></nav>;
 const statusClass=s=>s.toLowerCase().replace(" ","-");

 return <><Nav/><main>
 {page==="home"&&<section className="hero"><h1>See a civic problem? Make it visible.</h1><p>Report public issues anonymously, help communities identify problems, and track their resolution.</p>{!user&&<button className="primary" onClick={()=>go("signup")}>Create free account</button>}<button className={user?"primary":""} onClick={()=>go("map")}>View Public Map</button><div className="cards"><div><b>{dash?.total??0}</b><span>Total reports</span></div><div><b>{dash?.pending??0}</b><span>Pending</span></div><div><b>{dash?.resolved??0}</b><span>Resolved</span></div></div></section>}

 {page==="map"&&<section><h2>Public Issue Map</h2><div className="map">{issues.length?<MapContainer center={[19.076,72.8777]} zoom={11} style={{height:"100%",width:"100%"}}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{issues.filter(i=>i.latitude&&i.longitude).map(i=><Marker key={i.id} position={[Number(i.latitude),Number(i.longitude)]}><Popup><b>{i.category}</b><br/>{i.description}<br/><span className={"status "+statusClass(i.status)}>{i.status}</span></Popup></Marker>)}</MapContainer>:<p className="empty">No map points yet. Submit an issue with latitude and longitude.</p>}</div></section>}

 {page==="dashboard"&&<section><h2>Government Dashboard</h2><div className="cards dashboard"><div><b>{dash?.total??0}</b><span>Total</span></div><div><b>{dash?.pending??0}</b><span>Pending</span></div><div><b>{dash?.inProgress??0}</b><span>In Progress</span></div><div><b>{dash?.resolved??0}</b><span>Resolved</span></div></div><h3>Most Reported Problems</h3><div className="list">{dash?.categories?.map(c=><div key={c.category}><span>{c.category}</span><b>{c.count}</b></div>)||<p>No data yet.</p>}</div><h3>Recent Reports</h3><div className="table">{dash?.recent?.map(i=><div key={i.id} className="row"><span>{i.tracking_id}</span><span>{i.category}</span><span className={"status "+statusClass(i.status)}>{i.status}</span></div>)}</div></section>}

 {page==="track"&&<section><h2>Track Your Report</h2><form className="track" onSubmit={track}><input value={trackId} onChange={e=>setTrackId(e.target.value)} placeholder="Enter tracking ID e.g. CW-XXXX"/><button className="primary">Track</button></form>{tracked&&<div className="tracked">{tracked.error?<p>{tracked.error}</p>:<><h3>{tracked.category}</h3><p>{tracked.description}</p><p><b>Tracking ID:</b> {tracked.tracking_id}</p><p><b>Department:</b> {tracked.department}</p><p><b>Status:</b> <span className={"status "+statusClass(tracked.status)}>{tracked.status}</span></p></>}</div>}</section>}

 {page==="login"&&<section className="authpage"><form onSubmit={login} className="form authform"><h2>Welcome back</h2><p className="muted">Log in to your CivicWatch account.</p>
  <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label>
  <label>Password<input name="password" type="password" required autoComplete="current-password"/></label>
  {authMsg.text&&<div className={"authmsg "+authMsg.type} role="alert">{authMsg.text}</div>}
  <button className="primary">Log in</button>
  <p className="switch">New to CivicWatch? <a href="#signup" onClick={e=>{e.preventDefault();go("signup")}}>Create an account</a></p></form></section>}

 {page==="signup"&&<section className="authpage"><form onSubmit={signup} className="form authform"><h2>Create your account</h2><p className="muted">It takes less than a minute.</p>
  <label>Full name<input name="name" required autoComplete="name" placeholder="Your name"/></label>
  <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label>
  <label>Mobile number<input name="mobile" type="tel" required inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number"/></label>
  <label>Gender<select name="gender" required defaultValue=""><option value="" disabled>Select gender</option><option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option></select></label>
  <label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/></label>
  <label>Confirm password<input name="confirm" type="password" required minLength={8} autoComplete="new-password"/></label>
  {authMsg.text&&<div className={"authmsg "+authMsg.type} role="alert">{authMsg.text}</div>}
  <button className="primary">Sign up</button>
  <p className="switch">Already have an account? <a href="#login" onClick={e=>{e.preventDefault();go("login")}}>Log in</a></p></form></section>}
 </main><footer>CivicWatch • Community-powered civic issue visibility</footer></>
}
createRoot(document.getElementById("root")).render(<App/>);
