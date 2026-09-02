// estilos compartilhados pelas telas da recuperação
const S = {
  backdrop: {
    position:'fixed', inset:0, background:'rgba(0,0,0,.6)',
    display:'grid', placeItems:'center', zIndex:9999,
    boxSizing:'border-box', overflow:'hidden',
    width:'100%', height:'100%', maxHeight:'100dvh',
    padding:'max(8px, env(safe-area-inset-top, 0px)) max(8px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px))',
  },
  card: {
    width:'min(920px, 96vw)', maxWidth:'100%',
    maxHeight:'min(90dvh, 90vh)',
    display:'flex', flexDirection:'column', minHeight:0,
    overflow:'hidden', boxSizing:'border-box',
    background:'#15161a', color:'#e9ecf1',
    border:'1px solid rgba(255,255,255,.08)',
    borderRadius:20, boxShadow:'0 20px 50px rgba(0,0,0,.5)',
  },
  header: {
    flex:'0 0 auto',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.08)'
  },
  closeBtn:{
    width:36, height:36, borderRadius:10, border:'1px solid rgba(255,255,255,.15)',
    background:'transparent', color:'#fff', fontSize:20, cursor:'pointer'
  },
  body:{
    padding:16,
    flex:'1 1 auto',
    minHeight:0,
    overflowX:'hidden',
    overflowY:'auto',
    WebkitOverflowScrolling:'touch',
  },
  lead:{ opacity:.95, lineHeight:1.5 },
  bullets:{ margin:'8px 0 16px 18px' },
  rowBtns:{ display:'flex', gap:12, justifyContent:'flex-end', marginTop:12, flexWrap:'wrap' },
  cta:{
    padding:'12px 16px', border:0, borderRadius:12, color:'#fff',
    fontWeight:900, cursor:'pointer', boxShadow:'0 10px 24px rgba(0,0,0,.25)'
  },
  back:{
    padding:'10px 14px', borderRadius:12, border:'1px solid rgba(255,255,255,.15)',
    background:'transparent', color:'#e9ecf1', cursor:'pointer'
  },
  subHeader:{ marginBottom:8 },
  infoRow:{ display:'flex', gap:8, alignItems:'baseline', margin:'4px 0' },
  input:{
    width:'100%', padding:'12px 12px', borderRadius:12, background:'#0f1115',
    color:'#fff', border:'1px solid rgba(255,255,255,.15)', marginTop:10
  },
  option:{
    padding:16, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
    borderRadius:14, textAlign:'center', cursor:'pointer'
  },
  spin:{
    width:34, height:34, borderRadius:8, border:'1px solid rgba(255,255,255,.15)',
    background:'transparent', color:'#fff', fontSize:18, cursor:'pointer'
  }
}
export default S
