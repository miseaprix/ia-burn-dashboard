import React,{useState} from 'react';
export default function AdminPanel({title,subtitle,badge,defaultOpen=true,className='',children}){
 const [open,setOpen]=useState(defaultOpen);
 return <details className={`card admin-panel ${className}`} open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><span><h2>{title}</h2>{subtitle && <span className="admin-panel-subtitle">{subtitle}</span>}</span>{badge && <span className="admin-panel-count">{badge}</span>}</summary><div className="admin-panel-body">{children}</div></details>;
}
