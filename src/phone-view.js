import { useEffect, useState } from 'react';

export function usePhoneView() {
  const [phone,setPhone]=useState(()=>window.matchMedia('(max-width: 767px)').matches);
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 767px)');
    const change=()=>setPhone(query.matches);
    query.addEventListener('change',change);
    return()=>query.removeEventListener('change',change);
  },[]);
  return phone;
}
