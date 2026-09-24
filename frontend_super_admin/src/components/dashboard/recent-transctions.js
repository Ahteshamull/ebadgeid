// components/dashboard/recent-transactions.js
"use client"

import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock,
  CreditCard,
  Download,
  MoreHorizontal,
  Search,
  ShoppingCart,
  UserCircle,
  X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

// Sample transaction data
const transactions = [
  {
    id: "INV-001",
    amount: 249.99,
    status: "completed",
    email: "sarah.williams@example.com",
    name: "Sarah Williams",
    date: "Mar 2, 2025",
    type: "Subscription",
    paymentMethod: "Credit Card"
  },
  {
    id: "INV-002",
    amount: 125.50,
    status: "pending",
    email: "michael.brown@example.com",
    name: "Michael Brown",
    date: "Mar 1, 2025",
    type: "Product",
    paymentMethod: "PayPal"
  },
  {
    id: "INV-003",
    amount: 499.99,
    status: "completed",
    email: "jessica.davis@example.com",
    name: "Jessica Davis",
    date: "Feb 28, 2025",
    type: "Service",
    paymentMethod: "Credit Card"
  },
  {
    id: "INV-004",
    amount: 75.25,
    status: "failed",
    email: "david.miller@example.com",
    name: "David Miller",
    date: "Feb 27, 2025",
    type: "Product",
    paymentMethod: "Bank Transfer"
  },
  {
    id: "INV-005",
    amount: 349.99,
    status: "completed",
    email: "jennifer.wilson@example.com",
    name: "Jennifer Wilson",
    date: "Feb 26, 2025",
    type: "Subscription",
    paymentMethod: "Credit Card"
  },
  {
    id: "INV-006",
    amount: 89.50,
    status: "processing",
    email: "robert.taylor@example.com",
    name: "Robert Taylor",
    date: "Feb 25, 2025",
    type: "Product",
    paymentMethod: "PayPal"
  },
  {
    id: "INV-007",
    amount: 199.99,
    status: "completed",
    email: "linda.anderson@example.com",
    name: "Linda Anderson",
    date: "Feb 24, 2025",
    type: "Service",
    paymentMethod: "Credit Card"
  }
]

export function RecentTransactions() {
  const [sorting, setSorting] = useState({ column: "date", direction: "desc" })
  const [searchQuery, setSearchQuery] = useState("")

  // Status badge styling
  const statusStyles = {
    completed: { className: "bg-green-100 text-green-800 hover:bg-green-100", icon: <Check className="h-3.5 w-3.5 mr-1.5" /> },
    pending: { className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100", icon: <Clock className="h-3.5 w-3.5 mr-1.5" /> },
    processing: { className: "bg-blue-100 text-blue-800 hover:bg-blue-100", icon: <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" /> },
    failed: { className: "bg-red-100 text-red-800 hover:bg-red-100", icon: <X className="h-3.5 w-3.5 mr-1.5" /> }
  }

  // Payment method icons
  const paymentIcons = {
    "Credit Card": <CreditCard className="h-3.5 w-3.5 mr-1.5" />,
    "PayPal": <UserCircle className="h-3.5 w-3.5 mr-1.5" />,
    "Bank Transfer": <ArrowDown className="h-3.5 w-3.5 mr-1.5" />,
  }

  // Type icons
  const typeIcons = {
    "Product": <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />,
    "Service": <UserCircle className="h-3.5 w-3.5 mr-1.5" />,
    "Subscription": <ArrowUp className="h-3.5 w-3.5 mr-1.5" />
  }

  // Sorting handler
  const handleSort = (column) => {
    setSorting(prevSort => ({
      column,
      direction: prevSort.column === column && prevSort.direction === "asc" ? "desc" : "asc"
    }))
  }

  // Filter and sort data
  const displayData = [...transactions]
    .filter(item => {
      const searchLower = searchQuery.toLowerCase()
      return (
        item.id.toLowerCase().includes(searchLower) ||
        item.name.toLowerCase().includes(searchLower) ||
        item.email.toLowerCase().includes(searchLower) ||
        item.status.toLowerCase().includes(searchLower)
      )
    })
    .sort((a, b) => {
      const { column, direction } = sorting
      
      if (column === "amount") {
        return direction === "asc" ? a.amount - b.amount : b.amount - a.amount
      }
      
      // Default string comparison
      if (direction === "asc") {
        return a[column] > b[column] ? 1 : -1
      } else {
        return a[column] < b[column] ? 1 : -1
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">
                <div 
                  className="flex items-center cursor-pointer"
                  onClick={() => handleSort("id")}
                >
                  ID
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>
                <div 
                  className="flex items-center cursor-pointer"
                  onClick={() => handleSort("name")}
                >
                  Customer
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Type</TableHead>
              <TableHead>
                <div 
                  className="flex items-center cursor-pointer"
                  onClick={() => handleSort("status")}
                >
                  Status
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </div>
              </TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead>
                <div 
                  className="flex items-center cursor-pointer"
                  onClick={() => handleSort("date")}
                >
                  Date
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="text-right">
                <div 
                  className="flex items-center justify-end cursor-pointer"
                  onClick={() => handleSort("amount")}
                >
                  Amount
                  <ArrowUpDown className="ml-2 h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayData.map((transaction) => (
              <TableRow key={transaction.id}>
                <TableCell className="font-medium">{transaction.id}</TableCell>
                <TableCell>
                  <div>
                    <div className="font-medium">{transaction.name}</div>
                    <div className="text-sm text-muted-foreground">{transaction.email}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    {typeIcons[transaction.type]}
                    {transaction.type}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge 
                    variant="outline" 
                    className={statusStyles[transaction.status].className}
                  >
                    <div className="flex items-center">
                      {statusStyles[transaction.status].icon}
                      {transaction.status}
                    </div>
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    {paymentIcons[transaction.paymentMethod]}
                    {transaction.paymentMethod}
                  </div>
                </TableCell>
                <TableCell>{transaction.date}</TableCell>
                <TableCell className="text-right font-medium">
                  ${transaction.amount.toFixed(2)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem>View details</DropdownMenuItem>
                      <DropdownMenuItem>Send receipt</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>Refund transaction</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}