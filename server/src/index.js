import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express();
const PORT=process.env.PORT||8080;
const JWT_SECRET=process.env.JWT_SECRET||'dev-secret-change-me';
const isProd=process.env.NODE_ENV==='production';
app.use(cors({origin:process.env.CLIENT_ORIGIN||'http://localhost:5173',credentials:true}));
app.use(express.json({limit:'2mb'})); app.use(cookieParser()); app.use(morgan('tiny'));

const User=mongoose.model('User',new mongoose.Schema({name:String,email:{type:String,unique:true,lowercase:true},passwordHash:String,role:{type:String,default:'engineer'},division:{type:String,default:'TM & CAM / Stage-V'}} ,{timestamps:true}));
const Rate=mongoose.model('Rate',new mongoose.Schema({code:String,description:String,unit:{type:String,default:'Each'},category:{type:String,default:'Maintenance'},rate:Number,year:{type:String,default:'2026-27'},reference:String,active:{type:Boolean,default:true}},{timestamps:true}));
const Estimate=mongoose.model('Estimate',new mongoose.Schema({projectNo:String,workTitle:String,division:String,station:String,stage:String,unit:String,financialYear:String,prNo:String,indentNo:String,letterNo:String,date:String,costCentre:String,manufacturer:String,scope:String,cla:{type:[String],default:[]},notes:String,rows:[{sl:Number,code:String,description:String,qty:Number,unit:String,rate:Number,source:String}],charges:{supervision:Number,esi:Number,epf:Number,gst:Number},status:{type:String,default:'Draft'},createdBy:mongoose.Schema.Types.ObjectId},{timestamps:true}));
const Audit=mongoose.model('Audit',new mongoose.Schema({userId:mongoose.Schema.Types.ObjectId,action:String,entity:String,entityId:String,meta:Object},{timestamps:true}));
const Folder=mongoose.model('Folder',new mongoose.Schema({name:String,parentId:{type:mongoose.Schema.Types.ObjectId,default:null},createdBy:mongoose.Schema.Types.ObjectId},{timestamps:true}));
const FileDoc=mongoose.model('FileDoc',new mongoose.Schema({name:String,mime:String,size:Number,folderId:{type:mongoose.Schema.Types.ObjectId,default:null},gridId:mongoose.Schema.Types.ObjectId,createdBy:mongoose.Schema.Types.ObjectId},{timestamps:true}));

const sampleRates=[
['AN-8B III (09)','Cleaning and replacement of MOT Duplex filters & Jack oil filters',2893,'Labour'],
['AN-8B I (03)','Cleaning and replacement of MOT Bucket filter',7957,'Labour'],
['AN-8B X (03)','Cleaning and replacement of Vacuum pump filters',1086,'Labour'],
['AN-8B II (02)','Cleaning and replacement of seal oil pump filters',1807,'Labour'],
['AN-8B III (09)','Cleaning of HPSU strainers (TG, LPBP, HPBP)',2893,'Labour'],
['AN-8B IV (01)','Cleaning of Primary water system strainers',2989,'Labour'],
['AN-8B V (01)','Gland leaks arresting and minor repairs of water, steam, air line valves',2305,'Labour'],
['AN-8B V (02)','Oil, water and air leaks arresting',1807,'Labour'],
['AN-8B V (03)','Minor welding works',1309,'Labour']
];

function tokenFor(u){return jwt.sign({id:u._id.toString(),role:u.role,email:u.email,name:u.name},JWT_SECRET,{expiresIn:'8h'});}
function auth(req,res,next){const t=req.cookies.session; if(!t) return res.status(401).json({error:'Not authenticated'}); try{req.user=jwt.verify(t,JWT_SECRET);next()}catch{res.status(401).json({error:'Session expired'})}}
function num(v){return Number(v)||0}
function compute(e){const base=e.rows.reduce((s,r)=>s+num(r.qty)*num(r.rate),0); const supervision=num(e.charges?.supervision), esi=num(e.charges?.esi), epf=num(e.charges?.epf), gst=num(e.charges?.gst); return {base,supervision,esi,epf,gst,total:base+supervision+esi+epf+gst};}
async function audit(user,action,entity,id,meta={}){await Audit.create({userId:user.id,action,entity,entityId:String(id||''),meta}).catch(()=>{});}

app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.post('/api/auth/register',async(req,res)=>{try{const{name,email,password,division}=req.body;if(!name||!email||!password) return res.status(400).json({error:'Name, email and password are required'});if(await User.findOne({email})) return res.status(409).json({error:'Email already registered'});const u=await User.create({name,email,passwordHash:await bcrypt.hash(password,12),division:division||undefined});res.cookie('session',tokenFor(u),{httpOnly:true,sameSite:'lax',secure:isProd,maxAge:8*3600*1000});res.json({user:{name:u.name,email:u.email,role:u.role,division:u.division}})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{try{const{email,password}=req.body,u=await User.findOne({email});if(!u||!(await bcrypt.compare(password,u.passwordHash))) return res.status(401).json({error:'Invalid credentials'});res.cookie('session',tokenFor(u),{httpOnly:true,sameSite:'lax',secure:isProd,maxAge:8*3600*1000});res.json({user:{name:u.name,email:u.email,role:u.role,division:u.division}})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('session');res.json({ok:true})});
app.get('/api/auth/me',auth,async(req,res)=>{const u=await User.findById(req.user.id).select('name email role division');res.json({user:u})});

app.get('/api/rates',auth,async(req,res)=>{const q=req.query.q?{$or:[{description:new RegExp(req.query.q,'i')},{code:new RegExp(req.query.q,'i')},{category:new RegExp(req.query.q,'i')}]}:{};res.json(await Rate.find({...q,active:true}).sort({description:1}))});
app.post('/api/rates',auth,async(req,res)=>{const r=await Rate.create(req.body);await audit(req.user,'created','rate',r._id);res.json(r)});
app.put('/api/rates/:id',auth,async(req,res)=>{const r=await Rate.findByIdAndUpdate(req.params.id,req.body,{new:true});res.json(r)});
app.delete('/api/rates/:id',auth,async(req,res)=>{await Rate.findByIdAndDelete(req.params.id);res.json({ok:true})});

app.get('/api/estimates',auth,async(req,res)=>{const rows=await Estimate.find().sort({updatedAt:-1}).limit(100);res.json(rows.map(x=>({...x.toObject(),calc:compute(x)})))});
app.post('/api/estimates',auth,async(req,res)=>{const body={...req.body,createdBy:req.user.id};body.charges={supervision:num(body.charges?.supervision),esi:num(body.charges?.esi),epf:num(body.charges?.epf),gst:num(body.charges?.gst)};const e=await Estimate.create(body);await audit(req.user,'created','estimate',e._id,{title:e.workTitle});res.json({...e.toObject(),calc:compute(e)})});
app.get('/api/estimates/:id',auth,async(req,res)=>{const e=await Estimate.findById(req.params.id); if(!e) return res.status(404).json({error:'Not found'});res.json({...e.toObject(),calc:compute(e)})});
app.put('/api/estimates/:id',auth,async(req,res)=>{const e=await Estimate.findByIdAndUpdate(req.params.id,req.body,{new:true});await audit(req.user,'updated','estimate',e._id);res.json({...e.toObject(),calc:compute(e)})});
app.delete('/api/estimates/:id',auth,async(req,res)=>{await Estimate.findByIdAndDelete(req.params.id);res.json({ok:true})});

app.get('/api/audit',auth,async(req,res)=>res.json(await Audit.find().sort({createdAt:-1}).limit(100)));
app.get('/api/stats',auth,async(req,res)=>{const [est,draft,files,rates]=await Promise.all([Estimate.countDocuments(),Estimate.countDocuments({status:'Draft'}),FileDoc.countDocuments(),Rate.countDocuments({active:true})]);res.json({estimates:est,drafts:draft,files,rates})});

app.get('/api/folders',auth,async(req,res)=>res.json(await Folder.find().sort({name:1})));
app.post('/api/folders',auth,async(req,res)=>{const f=await Folder.create({name:req.body.name,parentId:req.body.parentId||null,createdBy:req.user.id});res.json(f)});
app.delete('/api/folders/:id',auth,async(req,res)=>{await Folder.deleteMany({$or:[{_id:req.params.id},{parentId:req.params.id}]});await FileDoc.deleteMany({folderId:req.params.id});res.json({ok:true})});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024}});
app.post('/api/files/upload',auth,upload.single('file'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'File is required'});const db=mongoose.connection.db;const bucket=new mongoose.mongo.GridFSBucket(db,{bucketName:'divisionFiles'});const uploadStream=bucket.openUploadStream(req.file.originalname,{contentType:req.file.mimetype,metadata:{uploadedBy:req.user.id}});uploadStream.end(req.file.buffer);uploadStream.on('finish',async()=>{const f=await FileDoc.create({name:req.file.originalname,mime:req.file.mimetype,size:req.file.size,folderId:req.body.folderId||null,gridId:uploadStream.id,createdBy:req.user.id});res.json(f)});});
app.get('/api/files',auth,async(req,res)=>{const q=req.query.folderId?{folderId:req.query.folderId}:req.query.root==='true'?{folderId:null}:{};res.json(await FileDoc.find(q).sort({name:1}))});
app.get('/api/files/:id/download',auth,async(req,res)=>{const f=await FileDoc.findById(req.params.id);if(!f)return res.status(404).end();res.setHeader('Content-Type',f.mime);res.setHeader('Content-Disposition',`attachment; filename="${encodeURIComponent(f.name)}"`);const bucket=new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:'divisionFiles'});bucket.openDownloadStream(f.gridId).pipe(res)});
app.delete('/api/files/:id',auth,async(req,res)=>{const f=await FileDoc.findById(req.params.id);if(f){const bucket=new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:'divisionFiles'});await bucket.delete(f.gridId).catch(()=>{});await f.deleteOne()}res.json({ok:true})});

app.get('/api/template/:type/:id',auth,async(req,res)=>{const e=await Estimate.findById(req.params.id);if(!e)return res.status(404).json({error:'Not found'});res.json({estimate:e,calc:compute(e),type:req.params.type})});

app.use('/api', (err,req,res,next)=>res.status(500).json({error:err.message}));
if(isProd){const clientDist=path.join(__dirname,'../../client/dist');app.use(express.static(clientDist));app.get(/.*/,(req,res)=>res.sendFile(path.join(clientDist,'index.html')))}

mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/division_estimate_suite').then(async()=>{
  if(process.env.SEED_DEMO==='true'){
    const u=await User.findOne({email:'admin@example.com'}); if(!u) await User.create({name:'Demo Administrator',email:'admin@example.com',passwordHash:await bcrypt.hash('Admin@123',12),role:'admin',division:'TM & CAM / Stage-V'});
    if(await Rate.countDocuments()===0) await Rate.insertMany(sampleRates.map(([code,description,rate,category])=>({code,description,rate,category,year:'2026-27',reference:'Supplied 2026-27 sample screenshot',unit:'Each'})));
    if(await Estimate.countDocuments()===0){const rates=await Rate.find().sort({createdAt:1}).lean();const qty=[24,2,146,40,6,5,33,20,30];const rows=rates.slice(0,9).map((r,i)=>({sl:i+1,code:r.code,description:r.description,qty:qty[i],unit:r.unit,rate:r.rate,source:r.reference}));await Estimate.create({projectNo:'DEMO-001',workTitle:'Attending repairs, periodic & preventive maintenance works for Main turbine of Sub Division-I of Unit-8 and as and when required for the year 2026-27 in TM & CAM division in Stage-V of Dr.NTTPS.',division:'TM & CAM / Stage-V',station:'Dr.NTTPS, Ibrahimpatnam',stage:'Stage-V',unit:'Unit-8',financialYear:'2026-27',prNo:'130060239',indentNo:'',letterNo:'EE/TM&C/S-D1/Stage-V/Dr.NTTPS',date:'2026-03-18',costCentre:'45305803',manufacturer:'M/s Eaton Industrial Products Pvt. Ltd.',scope:'Attending repairs, periodic & preventive maintenance works for Main Turbine of Unit-8.',cla:defaultCla,rows,charges:{supervision:0,esi:3.25,epf:13,gst:18},status:'Draft',createdBy:(await User.findOne({email:'admin@example.com'}))._id});}
  }
  app.listen(PORT,()=>console.log(`Division Estimate Suite listening on ${PORT}`));
}).catch(e=>{console.error(e);process.exit(1)});
