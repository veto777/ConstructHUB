import { useQuery } from "@tanstack/react-query";
export function useAppOrigin(): string {
  const { data } = useQuery<{ appOrigin: string }>({ queryKey: ["/api/public-config"], staleTime: Infinity });
  return data?.appOrigin || window.location.origin;
}
