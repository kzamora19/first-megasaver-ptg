import AcceptInvitation from "./accept-invitation";
export const dynamic="force-dynamic";
export default async function AcceptInvitationPage({searchParams}:{searchParams:Promise<{token?:string}>}){
 const params=await searchParams;
 return <AcceptInvitation token={params.token??""}/>;
}
