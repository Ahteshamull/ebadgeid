"use client"
import { useLocalization } from '../../context/LocalizationContext';
import { helpdeskTranslations, languages as availableLanguages } from '../../locales';
import { Search, Plus, MessageCircle, BarChart3, ArrowRight, ChevronDown, ChevronUp, Clock, Users, Zap, Loader2, AlertCircle, X, Send, Briefcase, Globe, TrendingUp, ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_BASE_URL, ORGANIZATION_CODE } from '@/lib/config';

export default function CareersPage() {
   const { language, changeLanguage } = useLocalization();
     const [expandedFaq, setExpandedFaq] = useState(null);
      const [faqItems, setFaqItems] = useState([]);
      const [faqLoading, setFaqLoading] = useState(true);
      const [faqError, setFaqError] = useState(null);
      const [articles, setArticles] = useState([]);
      const [articlesLoading, setArticlesLoading] = useState(true);
      const [articlesError, setArticlesError] = useState(null);
      const [showTicketModal, setShowTicketModal] = useState(false);
      const [ticketFormData, setTicketFormData] = useState({
        ticket_title: '',
        department: '',
        ticket_description: '',
        priority: 'medium',
        usernameOrEmail: ''
      });
      const [submitLoading, setSubmitLoading] = useState(false);
      const [submitError, setSubmitError] = useState(null);
      const [submitSuccess, setSubmitSuccess] = useState(false);
      const t = helpdeskTranslations[language] || helpdeskTranslations.en;
      // Handle form input changes
      const handleInputChange = (e) => {
        const { name, value } = e.target;
        setTicketFormData(prev => ({
          ...prev,
          [name]: value
        }));
      };
    
      // Handle ticket submission
      const handleTicketSubmit = async (e) => {
        e.preventDefault();
        setSubmitLoading(true);
        setSubmitError(null);
    
        try {
          const ticketData = {
            ticket_title: ticketFormData.ticket_title,
            department: ticketFormData.department,
            ticket_description: ticketFormData.ticket_description,
            priority: ticketFormData.priority,
            usernameOrEmail: ticketFormData.usernameOrEmail
          };
    
          const response = await fetch(`${API_BASE_URL}/tickets/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(ticketData)
          });
    
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
    
          const result = await response.json();
          
          setSubmitSuccess(true);
          // Reset form
          setTicketFormData({
            ticket_title: '',
            department: '',
            ticket_description: '',
            priority: 'medium',
            usernameOrEmail: ''
          });
    
          // Close modal after 2 seconds
          setTimeout(() => {
            setShowTicketModal(false);
            setSubmitSuccess(false);
          }, 2000);
    
        } catch (error) {
          console.error('Error submitting ticket:', error);
          setSubmitError('Failed to submit ticket. Please try again.');
        } finally {
          setSubmitLoading(false);
        }
      };
    
      // Close modal
      const closeModal = () => {
        setShowTicketModal(false);
        setSubmitError(null);
        setSubmitSuccess(false);
        setTicketFormData({
          ticket_title: '',
          department: '',
          ticket_description: '',
          priority: 'medium',
          usernameOrEmail: ''
        });
      };
    
      useEffect(() => {
        const fetchFaqs = async () => {
          try {
            setFaqLoading(true);
            const response = await fetch(`${API_BASE_URL}/faqs/?organization_code=${encodeURIComponent(ORGANIZATION_CODE)}`);
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Filter only visible FAQs and transform the data structure
            const visibleFaqs = (data.data || data)
              .filter(faq => faq.faq_status === 'visible')
              .map(faq => ({
                id: faq._id,
                question: faq.faq_title,
                answer: faq.faq_body,
                createdAt: faq.createdAt
              }));
            
            setFaqItems(visibleFaqs);
            setFaqError(null);
          } catch (error) {
            console.error('Error fetching FAQs:', error);
            setFaqError('Failed to load FAQs. Please try again later.');
            setFaqItems([]);
          } finally {
            setFaqLoading(false);
          }
        };
    
        const fetchArticles = async () => {
          try {
            setArticlesLoading(true);
            const response = await fetch(`${API_BASE_URL}/articles/?organization_code=${encodeURIComponent(ORGANIZATION_CODE)}`);
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Transform the data structure and calculate estimated read time
            const transformedArticles = data.map(article => ({
              id: article._id,
              code: article.article_code,
              title: article.article_title,
              category: article.article_category,
              author: article.author,
              contentUrl: article.article_content,
              createdAt: article.createdAt,
              updatedAt: article.updatedAt,
              readTime: 'Open article'
            }));
            
            setArticles(transformedArticles);
            setArticlesError(null);
          } catch (error) {
            console.error('Error fetching articles:', error);
            setArticlesError('Failed to load articles. Please try again later.');
            setArticles([]);
          } finally {
            setArticlesLoading(false);
          }
        };
    
        fetchFaqs();
        fetchArticles();
      }, []);
    
      const handleArticleClick = (articleCode) => {
        // Navigate to the article page using the article code
        window.location.href = `/articles/${articleCode}`;
      };
    
  return (
    <>
      {/* Header with Back Button */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-emerald-600 transition-colors group"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="font-medium">{t.header.backButton}</span>
          </button>
        </div>
      </div>

    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 to-teal-50">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mb-6">
              <Briefcase className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
              {t.careers.heroTitle} <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-600">{t.careers.heroHighlight}</span>
            </h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              {t.careers.heroSubtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Current Status */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-2xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full mb-6 shadow-md">
            <Users className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            {t.careers.statusTitle}
          </h2>
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            {t.careers.statusSubtitle}
          </p>
          <a 
            href="#culture" 
            className="inline-block px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg font-semibold hover:from-emerald-600 hover:to-teal-600 transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            {t.careers.learnAboutUs}
          </a>
        </div>
      </div>

      {/* Why Work With Us */}
      <div className="max-w-6xl mx-auto px-6 py-16 pb-24" id="culture">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">{t.careers.whyTitle}</h2>
          <p className="text-gray-600 text-lg">{t.careers.whySubtitle}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-white border-2 border-gray-200 rounded-xl p-8 hover:border-emerald-300 hover:shadow-lg transition-all duration-300 group">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-6 group-hover:bg-emerald-200 transition-colors">
              <Globe className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">{t.careers.globalImpactTitle}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t.careers.globalImpactDesc}
            </p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-8 hover:border-emerald-300 hover:shadow-lg transition-all duration-300 group">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-6 group-hover:bg-emerald-200 transition-colors">
              <TrendingUp className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">{t.careers.growthTitle}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t.careers.growthDesc}
            </p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-8 hover:border-emerald-300 hover:shadow-lg transition-all duration-300 group">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-6 group-hover:bg-emerald-200 transition-colors">
              <Users className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">{t.careers.collabTitle}</h3>
            <p className="text-gray-600 leading-relaxed">
              {t.careers.collabDesc}
            </p>
          </div>
        </div>
      </div>
    </div>
    {/* Footer */}
         <footer className="bg-black text-gray-400 relative overflow-hidden">
               <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
               
               <div className="max-w-7xl mx-auto px-6">
                 <div className="py-16">
                   <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
                     
                     <div className="md:col-span-5">
                       <div className="flex items-center space-x-3 mb-6">
                         <div className="w-20 h-20 flex items-center justify-center">
                           <img src="/helpdesk_logo.webp" alt="eBadgeId Logo" className="w-full h-full object-contain" />
                         </div>
                         <h3 className="text-2xl font-light tracking-wide text-white">
                           eBadgeId <span className="font-normal">Helpdesk</span>
                         </h3>
                       </div>
                       <p className="text-gray-500 leading-7 text-sm max-w-md">
                         {t.footer.description}
                       </p>
                     </div>
       
                     <div className="md:col-span-3">
                       <h4 className="text-white text-sm font-semibold uppercase tracking-wider mb-6 relative inline-block">
                         {t.footer.company}
                         <span className="absolute bottom-0 left-0 w-8 h-px bg-white"></span>
                       </h4>
                       <ul className="space-y-3">
                         <li>
                           <a href="/hiring" className="text-sm hover:text-white transition-colors duration-300 hover:translate-x-1 inline-block">
                             {t.footer.careers}
                           </a>
                         </li>
                         <li>
                           <a href="/status" className="text-sm hover:text-white transition-colors duration-300 hover:translate-x-1 inline-block">
                             {t.footer.systemStatus}
                           </a>
                         </li>
                       </ul>
                     </div>
       
       {/* Same "Connect" social block removed from src/app/page.js — this
           Facebook link was the last of the Soraroam-era social links
           (LinkedIn/Instagram/TikTok already removed, see AUDIT_FIXES.md),
           confirmed to be foreign-brand residue, not an eBadge ID account. */}

                   </div>
                 </div>
       
                 <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent"></div>
       
                 <div className="py-8">
                   <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                     <p className="text-xs text-gray-600 tracking-wide">
                       {t.footer.copyright}
                     </p>
                     <div className="flex items-center space-x-8">
                       <a 
                         href="#" 
                         className="text-xs text-gray-600 hover:text-white transition-colors duration-300 tracking-wide"
                       >
                         {t.footer.privacy}
                       </a>
                       <span className="text-gray-800">|</span>
                       <a 
                         href="#" 
                         className="text-xs text-gray-600 hover:text-white transition-colors duration-300 tracking-wide"
                       >
                         {t.footer.terms}
                       </a>
                     </div>
                   </div>
                 </div>
               </div>
             </footer>
    </>
  );
}
