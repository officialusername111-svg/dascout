// Generated from the DaScout Supabase project (kogpuuidawbmttyswvsx).
// Regenerate after any schema change:  supabase gen types typescript --linked > supabase/types/database.types.ts
// Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      favorites: {
        Row: { created_at: string; listing_id: string; profile_id: string }
        Insert: { created_at?: string; listing_id: string; profile_id: string }
        Update: { created_at?: string; listing_id?: string; profile_id?: string }
      }
      features: {
        Row: { id: string; name: string; slug: string }
        Insert: { id?: string; name: string; slug: string }
        Update: { id?: string; name?: string; slug?: string }
      }
      listing_features: {
        Row: { feature_id: string; listing_id: string }
        Insert: { feature_id: string; listing_id: string }
        Update: { feature_id?: string; listing_id?: string }
      }
      listing_photos: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          is_primary: boolean
          listing_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          listing_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          listing_id?: string
          sort_order?: number
          storage_path?: string
        }
      }
      listing_views: {
        Row: {
          id: string
          listing_id: string
          profile_id: string | null
          session_hash: string | null
          viewed_at: string
        }
        Insert: {
          id?: string
          listing_id: string
          profile_id?: string | null
          session_hash?: string | null
          viewed_at?: string
        }
        Update: {
          id?: string
          listing_id?: string
          profile_id?: string | null
          session_hash?: string | null
          viewed_at?: string
        }
      }
      listings: {
        Row: {
          area_detail: string | null
          bathrooms: number | null
          bedrooms: number | null
          broker_id: string | null
          category: Database["public"]["Enums"]["listing_category"]
          created_at: string
          created_by: string | null
          description: string | null
          floor_area_sqm: number | null
          id: string
          is_trending: boolean
          lot_area_sqm: number | null
          price_php: number
          published_at: string | null
          search_vector: unknown
          slug: string
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          town_id: string
          updated_at: string
        }
        Insert: {
          area_detail?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          category: Database["public"]["Enums"]["listing_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          floor_area_sqm?: number | null
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php: number
          published_at?: string | null
          slug: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          town_id: string
          updated_at?: string
        }
        Update: {
          area_detail?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          broker_id?: string | null
          category?: Database["public"]["Enums"]["listing_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          floor_area_sqm?: number | null
          id?: string
          is_trending?: boolean
          lot_area_sqm?: number | null
          price_php?: number
          published_at?: string | null
          slug?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          town_id?: string
          updated_at?: string
        }
      }
      price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          listing_id: string
          new_price: number
          old_price: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          listing_id: string
          new_price: number
          old_price?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          listing_id?: string
          new_price?: number
          old_price?: number | null
        }
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
      }
      property_requests: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          category: Database["public"]["Enums"]["listing_category"] | null
          created_at: string
          email: string
          id: string
          is_handled: boolean
          notes: string | null
          preferred_town: string | null
          profile_id: string | null
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          created_at?: string
          email: string
          id?: string
          is_handled?: boolean
          notes?: string | null
          preferred_town?: string | null
          profile_id?: string | null
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          category?: Database["public"]["Enums"]["listing_category"] | null
          created_at?: string
          email?: string
          id?: string
          is_handled?: boolean
          notes?: string | null
          preferred_town?: string | null
          profile_id?: string | null
        }
      }
      towns: {
        Row: {
          created_at: string
          id: string
          initial: string | null
          name: string
          province: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          province: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          province?: string
          slug?: string
        }
      }
      verification_events: {
        Row: {
          id: string
          kind: Database["public"]["Enums"]["verification_kind"]
          listing_id: string
          notes: string | null
          occurred_at: string
          performed_by: string | null
        }
        Insert: {
          id?: string
          kind: Database["public"]["Enums"]["verification_kind"]
          listing_id: string
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
        }
        Update: {
          id?: string
          kind?: Database["public"]["Enums"]["verification_kind"]
          listing_id?: string
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      is_staff: { Args: never; Returns: boolean }
      top_listings: {
        Args: { period?: string; row_limit?: number }
        Returns: { listing_id: string; views: number }[]
      }
    }
    Enums: {
      listing_category:
        | "residential_lot"
        | "farm_land"
        | "commercial_lot"
        | "residential_building"
        | "commercial_building"
      listing_status: "draft" | "verifying" | "live" | "sold" | "withdrawn"
      user_role: "buyer" | "broker" | "staff" | "admin"
      verification_kind: "title_check" | "ground_validation" | "published"
    }
    CompositeTypes: Record<string, never>
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      listing_category: [
        "residential_lot",
        "farm_land",
        "commercial_lot",
        "residential_building",
        "commercial_building",
      ],
      listing_status: ["draft", "verifying", "live", "sold", "withdrawn"],
      user_role: ["buyer", "broker", "staff", "admin"],
      verification_kind: ["title_check", "ground_validation", "published"],
    },
  },
} as const
