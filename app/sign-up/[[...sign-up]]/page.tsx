import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "#092448",
            fontFamily: "var(--font-sans)",
            borderRadius: "0.5rem",
          },
        }}
      />
    </div>
  );
}
