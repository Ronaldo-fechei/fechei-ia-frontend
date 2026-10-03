import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "sonner";
import { ApiError } from "./lib/api";
import { router } from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { ConfirmProvider } from "./components/ui";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RadixTooltip.Provider>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <Toaster position="top-right" richColors closeButton />
          </ConfirmProvider>
        </RadixTooltip.Provider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
